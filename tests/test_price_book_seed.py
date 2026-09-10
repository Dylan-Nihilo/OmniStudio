"""The shipped seed must be quotable by the exact params the app sends at generation time.

The seed is written by hand from vendor price lists, while quotes go through
metering.normalize_params. If the two disagree on match keys, every generation fails with
PRICING_ITEM_NOT_FOUND the moment billing is switched on — this test pins them together.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.billing import BillingError, BillingServices
from src.billing.metering import JobBillingHook
from src.storage.db import create_engine, init_schema

SEED = Path(__file__).resolve().parents[1] / "config" / "pricing" / "price_book.seed.json"


@pytest.fixture
def published():
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    engine = create_engine(":memory:")
    init_schema(engine)
    services = BillingServices.build(engine)
    services.price_admin.update_rule(None, **seed["rule"])
    for item in seed["items"]:
        services.price_admin.upsert_item(None, **item)
    services.price_admin.publish(None, note="seed")
    services.runtime.invalidate()
    return services


class _Catalog:
    """Only the legacy ids the specs below use; the real catalog is loaded at runtime."""

    _MAP = {
        "wan2.7-i2v": "wan/wan2.7-video#i2v",
        "wan2.7-image-pro": "wan/wan2.7-image-pro#image",
        "gpt-image-2": "gpt-image/gpt-image-2#image",
        "kling-v3-i2v": "kling/kling-v3-video#i2v",
    }

    def resolve_legacy_to_canonical(self, flat_id: str) -> str | None:
        return self._MAP.get(flat_id)


def test_seed_publishes_and_every_row_clears_the_margin_target(published):
    table = published.runtime.require_current().table()
    assert len(table) == 73
    assert [row["item_id"] for row in table if not row["meets_target"]] == []


@pytest.mark.parametrize(
    "spec,expected_credits",
    [
        # video: seconds x per-second credits, spec straight off the VideoTask
        ({"model_id": "wan2.7-i2v", "stage": "video", "params": {"resolution": "1080p", "ratio": "16:9"}, "quantity": 5}, 220),
        ({"model_id": "wan2.7-i2v", "stage": "video", "params": {"resolution": "720p"}, "quantity": 5}, 135),
        # kling prices by mode, not resolution
        ({"model_id": "kling-v3-i2v", "stage": "video", "params": {"resolution": None, "mode": "pro"}, "quantity": 5}, 180),
        ({"model_id": "kling-v3-i2v", "stage": "video", "params": {"mode": "std", "audio_mode": "native"}, "quantity": 5}, 200),
        # image: a flat-priced model must quote at every size tier
        ({"model_id": "wan2.7-image-pro", "stage": "image", "params": {"size": "1024*1024"}, "quantity": 1}, 22),
        ({"model_id": "wan2.7-image-pro", "stage": "image", "params": {"size": "2048*2048"}, "quantity": 4}, 88),
        # image: tiered by quality, then by size within a quality
        ({"model_id": "gpt-image-2", "stage": "image", "params": {"size": "1024*1024", "quality": "low"}, "quantity": 1}, 2),
        ({"model_id": "gpt-image-2", "stage": "image", "params": {"size": "3840x2160", "quality": "high"}, "quantity": 1}, 265),
    ],
)
def test_specs_the_app_sends_resolve_to_a_price(published, spec, expected_credits):
    hook = JobBillingHook(published, catalog=_Catalog(), enabled=True)
    assert hook.quote_spec(spec).credits == expected_credits


def test_text_and_tts_quote_through_their_own_entry_points(published):
    assert published.runtime.quote_text("text/deepseek-v4-flash", 20_000, 5_000).credits == 5
    # TTS passes no variant, so each voice model needs a catch-all row
    assert published.runtime.quote("tts/cosyvoice-v2", {}, 600 / 10_000).credits == 6


def test_a_spec_outside_the_price_book_is_refused_rather_than_free(published):
    hook = JobBillingHook(published, catalog=_Catalog(), enabled=True)
    with pytest.raises(BillingError) as error:
        hook.quote_spec({"model_id": "wan2.7-i2v", "stage": "video", "params": {"resolution": "480p"}, "quantity": 5})
    assert error.value.code == "PRICING_ITEM_NOT_FOUND"
