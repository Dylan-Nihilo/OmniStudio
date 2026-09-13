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
        "seedance-2.0-i2v": "seedance/seedance-2.0-video#i2v",
        "seedance-2.0-r2v": "seedance/seedance-2.0-video#r2v",
        "gpt-image-2": "gpt-image/gpt-image-2#image",
    }

    def resolve_legacy_to_canonical(self, flat_id: str) -> str | None:
        return self._MAP.get(flat_id)


def test_seed_publishes_and_every_row_clears_the_margin_target(published):
    table = published.runtime.require_current().table()
    assert len(table) == 34
    assert [row["item_id"] for row in table if not row["meets_target"]] == []


@pytest.mark.parametrize(
    "spec,expected_credits",
    [
        # video: seconds x per-second credits, spec straight off the VideoTask
        ({"model_id": "seedance-2.0-i2v", "stage": "video", "params": {"resolution": "1080p", "ratio": "16:9"}, "quantity": 5}, 470),
        ({"model_id": "seedance-2.0-r2v", "stage": "video", "params": {"resolution": "720p"}, "quantity": 5}, 190),
        # MiniMax prices by its own resolution names
        ({"model_id": "minimax/minimax-h3#i2v", "stage": "video", "params": {"resolution": "2K"}, "quantity": 5}, 110),
        ({"model_id": "minimax/minimax-h3#i2v", "stage": "video", "params": {"resolution": "1K"}, "quantity": 10}, 140),
        # image: gpt-image-2 is tiered by resolution, and quality must not block the match
        ({"model_id": "gpt-image-2", "stage": "image", "params": {"size": "1024*1024"}, "quantity": 1}, 3),
        ({"model_id": "gpt-image-2", "stage": "image", "params": {"size": "2048*2048", "quality": "high"}, "quantity": 4}, 20),
        ({"model_id": "gpt-image-2", "stage": "image", "params": {"size": "3840x2160"}, "quantity": 1}, 6),
        # a size we cannot read falls back to the top tier rather than being refused
        ({"model_id": "gpt-image-2", "stage": "image", "params": {}, "quantity": 1}, 6),
    ],
)
def test_specs_the_app_sends_resolve_to_a_price(published, spec, expected_credits):
    hook = JobBillingHook(published, catalog=_Catalog(), enabled=True)
    assert hook.quote_spec(spec).credits == expected_credits


def test_text_and_tts_quote_through_their_own_entry_points(published):
    # the model id is whatever the LLM adapter sends upstream, i.e. the newapi model name;
    # quantities are characters, billed per 1000 at whole-credit rates
    assert published.runtime.quote_text("text/DeepSeek-V4.1-Flash", 20_000, 5_000).credits == 25
    assert published.runtime.quote_text("text/claude-opus-5", 20_000, 5_000).credits == 30
    # 600 characters of dialogue at 9 credits per 1000
    assert published.runtime.quote("tts/cosyvoice-v2", {}, 600 / 1000).credits == 6


def test_a_spec_outside_the_price_book_is_refused_rather_than_free(published):
    hook = JobBillingHook(published, catalog=_Catalog(), enabled=True)
    with pytest.raises(BillingError) as error:
        # Seedance 2.0 is only priced at 720p/1080p, matching the resolutions the catalog offers
        hook.quote_spec({"model_id": "seedance-2.0-i2v", "stage": "video", "params": {"resolution": "480p"}, "quantity": 5})
    assert error.value.code == "PRICING_ITEM_NOT_FOUND"


def test_text_tiers_never_get_cheaper_as_they_get_better(published):
    """Whole-credit rates flatten the cheap tiers together, but must never invert."""
    snapshot = published.runtime.require_current()
    costs = [snapshot.quote(f"text/{name}", {"direction": "out"}, 1).credits for name in
             ("DeepSeek-V4.1-Flash", "gemini-3.7-flash", "gpt-5.6-sol", "claude-opus-5")]
    assert costs == sorted(costs), costs


def test_every_image_stays_inside_the_price_band_we_promised(published):
    """每张图的标价落在 1 毛到 1 元之间——低于说明成本填错了，高于说明档位选错了。"""
    snapshot = published.runtime.require_current()
    for row in snapshot.table():
        if row["stage"] != "image":
            continue
        assert 0.1 <= row["credits"] * snapshot.rule.credit_face_value_cny <= 1.0, row


def test_every_rate_is_a_whole_number_of_credits(published):
    """The promise to users: multiply a whole rate by seconds, images or thousands of
    characters and you have the bill. A fractional rate would break that arithmetic."""
    for row in published.runtime.require_current().table():
        assert row["credits"] == int(row["credits"]) and row["credits"] >= 1, row
