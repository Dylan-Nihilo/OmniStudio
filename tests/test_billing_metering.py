"""Job items freeze credits on create and settle/release on terminal transitions."""

from __future__ import annotations

import time
import uuid

import pytest
from sqlalchemy import insert

from src.billing import BillingError, BillingServices
from src.billing.metering import JobBillingHook, TextMeter, normalize_params, resolve_model_id, size_tier
from src.storage.db import create_engine, init_schema
from src.storage.job_repository import JobRepository
from src.storage.schema import User, Workspace


class _Catalog:
    def resolve_legacy_to_canonical(self, flat_id: str) -> str | None:
        return {"wan2.7-i2v": "wan/wan2.7-video#i2v", "wan2.7-image-pro": "wan/wan2.7-image-pro#image"}.get(flat_id)


@pytest.fixture
def env(monkeypatch):
    engine = create_engine(":memory:")
    init_schema(engine)
    now = time.time()
    with engine.begin() as connection:
        connection.execute(insert(User.__table__).values(
            id="u1", username="owner", username_normalized="owner", email="o@x.io", email_normalized="o@x.io",
            display_name=None, password_hash="x", created_at=now, updated_at=now))
        connection.execute(insert(Workspace.__table__).values(
            id="ws1", owner_user_id="u1", name="ws", slug="ws", created_at=now, updated_at=now, metadata_json="{}"))
    services = BillingServices.build(engine)
    admin = services.price_admin
    admin.upsert_item("u1", model_id="wan/wan2.7-video#i2v", stage="video", billing_unit="second",
                      match={"resolution": "1080p"}, purchase_price_cny=1.0)          # 44 credits / s
    admin.upsert_item("u1", model_id="wan/wan2.7-image-pro#image", stage="image", billing_unit="image",
                      match={}, purchase_price_cny=0.5)                                # 22 credits / image
    admin.upsert_item("u1", model_id="text/qwen3.7-plus", stage="text", billing_unit="token_1m",
                      match={"direction": "in"}, purchase_price_cny=2.0)
    admin.upsert_item("u1", model_id="text/qwen3.7-plus", stage="text", billing_unit="token_1m",
                      match={"direction": "out"}, purchase_price_cny=8.0)
    admin.publish("u1")
    hook = JobBillingHook(services, catalog=_Catalog(), enabled=True)
    repo = JobRepository(engine, billing_hook=hook)
    wallet = services.wallets.for_workspace("ws1")
    services.wallets.credit(wallet["id"], 1000, "grant", "seed")
    monkeypatch.setattr("src.billing.metering.probe_duration_seconds", lambda uri, root="output": 4.0)
    return services, hook, repo, wallet["id"]


def _job(repo: JobRepository) -> str:
    return repo.create_job("ws1", "video").id


def test_normalisation_helpers():
    assert size_tier("1280*1280") == "2K" and size_tier("1024x1024") == "1K" and size_tier("3840x2160") == "4K"
    assert normalize_params("video", {"resolution": "1080p", "mode": "pro", "sound": True, "ratio": "16:9"}) == {
        "resolution": "1080p", "mode": "pro", "audio": True}
    assert normalize_params("image", {"size": "2048*2048", "quality": "high", "seed": 1}) == {"size_tier": "2K", "quality": "high"}
    assert resolve_model_id("wan2.7-i2v", _Catalog()) == "wan/wan2.7-video#i2v"
    assert resolve_model_id("text/qwen3.7-plus", _Catalog()) == "text/qwen3.7-plus"


def test_video_item_holds_then_settles_on_probed_seconds(env):
    services, hook, repo, wallet_id = env
    item = repo.create_item(_job(repo), "video", "video:1", payload={
        "billing": {"model_id": "wan2.7-i2v", "stage": "video", "params": {"resolution": "1080p", "ratio": "16:9"}, "quantity": 5}})
    assert item.payload["billing"]["credits"] == 220 and item.payload["billing"]["held"] is True
    assert services.wallets.balance(wallet_id) == {"balance": 1000, "frozen": 220, "available": 780}

    repo.transition_item(item.id, "processing")
    repo.transition_item(item.id, "succeeded", media_refs=[{"id": "v", "kind": "video", "uri": "video/out.mp4"}])
    # ffprobe reported 4 s -> 176 credits charged, 44 released
    assert services.wallets.balance(wallet_id) == {"balance": 824, "frozen": 0, "available": 824}
    entries = services.wallets.ledger(wallet_id)
    assert entries[0]["type"] == "settle" and entries[0]["amount"] == -176 and entries[0]["quantity"] == 4.0


def test_failed_item_releases_and_retry_requotes(env):
    services, hook, repo, wallet_id = env
    item = repo.create_item(_job(repo), "video", "video:2", payload={
        "billing": {"model_id": "wan2.7-i2v", "stage": "video", "params": {"resolution": "1080p"}, "quantity": 5}})
    repo.transition_item(item.id, "processing")
    repo.transition_item(item.id, "failed", error={"code": "PROVIDER_FAILED", "message": "boom"})
    assert services.wallets.balance(wallet_id)["frozen"] == 0

    retry = repo.create_retry(item.id, "video:2:retry")
    assert retry.payload["billing"]["held"] is True and retry.payload["billing"]["credits"] == 220
    assert services.wallets.balance(wallet_id)["frozen"] == 220
    repo.transition_item(retry.id, "canceled")
    assert services.wallets.balance(wallet_id) == {"balance": 1000, "frozen": 0, "available": 1000}


def test_image_batch_settles_on_delivered_count(env):
    services, hook, repo, wallet_id = env
    item = repo.create_item(_job(repo), "asset", "asset:1", payload={
        "billing": {"model_id": "wan2.7-image-pro", "stage": "image", "params": {"size": "1280*1280"}, "quantity": 4}})
    assert services.wallets.balance(wallet_id)["frozen"] == 88
    repo.transition_item(item.id, "processing")
    repo.transition_item(item.id, "succeeded", media_refs=[{"id": "a", "kind": "image", "uri": "a.png"},
                                                             {"id": "b", "kind": "image", "uri": "b.png"}])
    assert services.wallets.balance(wallet_id) == {"balance": 956, "frozen": 0, "available": 956}


def test_insufficient_credits_blocks_item_creation(env):
    services, hook, repo, wallet_id = env
    job_id = _job(repo)
    with pytest.raises(BillingError) as error:
        repo.create_item(job_id, "video", "video:big", payload={
            "billing": {"model_id": "wan2.7-i2v", "stage": "video", "params": {"resolution": "1080p"}, "quantity": 30}})
    assert error.value.status_code == 402
    assert repo.find_item_by_idempotency("ws1", "video:big") is None
    assert services.wallets.balance(wallet_id)["frozen"] == 0


def test_unpriced_model_is_rejected_not_free(env):
    services, hook, repo, wallet_id = env
    with pytest.raises(BillingError) as error:
        repo.create_item(_job(repo), "video", "video:x", payload={
            "billing": {"model_id": "wan2.7-i2v", "stage": "video", "params": {"resolution": "480p"}, "quantity": 5}})
    assert error.value.code == "PRICING_ITEM_NOT_FOUND"


def test_items_without_billing_spec_and_disabled_hook_are_untouched(env):
    services, hook, repo, wallet_id = env
    plain = repo.create_item(_job(repo), "export", "export:1", payload={"project_id": "p"})
    assert "billing" not in plain.payload
    hook._enabled = False
    off = repo.create_item(_job(repo), "video", "video:off", payload={
        "billing": {"model_id": "wan2.7-i2v", "stage": "video", "params": {"resolution": "1080p"}, "quantity": 5}})
    assert "held" not in off.payload["billing"]
    assert services.wallets.balance(wallet_id)["frozen"] == 0


def test_text_meter_charges_tokens_capped_at_balance(env):
    services, hook, repo, wallet_id = env
    meter = TextMeter(services, enabled=True)
    charged = meter.charge_tokens("ws1", "qwen3.7-plus", 20_000, 5_000, "llm:1")
    assert charged == 4 and services.wallets.balance(wallet_id)["available"] == 996
    assert meter.charge_tokens("ws1", "qwen3.7-plus", 20_000, 5_000, "llm:1") == 0     # idempotent
    services.wallets.credit(wallet_id, -994, "adjust", "drain", reason="test")
    assert meter.charge_tokens("ws1", "qwen3.7-plus", 1_000_000, 0, "llm:2") == 2       # capped at the 2 left
    with pytest.raises(BillingError):
        meter.ensure_available("ws1")
    assert TextMeter(services, enabled=False).charge_tokens("ws1", "qwen3.7-plus", 1, 1, "llm:3") == 0
