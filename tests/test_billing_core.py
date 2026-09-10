"""Credit ratio arithmetic, price book publish/quote, wallets and platform roles."""

from __future__ import annotations

import time

import pytest
from sqlalchemy import insert

from src.billing import BillingError, BillingServices, CreditRule
from src.storage.db import create_engine, init_schema
from src.storage.schema import User


def _make_user(engine, user_id: str) -> None:
    now = time.time()
    with engine.begin() as connection:
        connection.execute(insert(User.__table__).values(
            id=user_id, username=f"user-{user_id}", username_normalized=f"user-{user_id}", email=f"{user_id}@x.io",
            email_normalized=f"{user_id}@x.io", display_name=None, password_hash="x", created_at=now, updated_at=now))


@pytest.fixture
def billing():
    engine = create_engine(":memory:")
    init_schema(engine)
    return BillingServices.build(engine)


# ---------------------------------------------------------------- formula
def test_default_rule_is_44_credits_per_yuan():
    rule = CreditRule()
    assert rule.credits_per_yuan == pytest.approx(44)
    assert rule.credits_for_price(2.48) == 110      # Seedance 2.0 1080p / second
    assert rule.credits_for_price(0.20) == 9        # Wan image
    assert rule.credits_for_price(0.001) == 1       # floor
    assert rule.markup_for(2.48, 110) >= 1.20


def test_changing_l1_discount_keeps_target_markup():
    rule = CreditRule(l1_discount=0.4)
    assert rule.credits_per_yuan == pytest.approx(55)
    assert rule.markup_for(1.0, rule.credits_for_price(1.0)) == pytest.approx(1.20)


def test_preview_flags_promotions_below_target():
    assert CreditRule().preview(1.2, multiplier=0.8)["meets_target"] is False
    assert CreditRule().preview(1.2)["meets_target"] is True


def test_rule_rejects_nonsense():
    with pytest.raises(ValueError):
        CreditRule(l1_discount=0)
    with pytest.raises(ValueError):
        CreditRule(credit_face_value_cny=-1)


# ---------------------------------------------------------------- price book
def _seed_items(billing: BillingServices) -> None:
    admin = billing.price_admin
    admin.upsert_item("root", model_id="happyhorse/happyhorse-1.1-video#i2v", stage="video", billing_unit="second",
                      match={"resolution": "1080p"}, purchase_price_cny=1.20)
    admin.upsert_item("root", model_id="happyhorse/happyhorse-1.1-video#i2v", stage="video", billing_unit="second",
                      match={"resolution": "720p"}, purchase_price_cny=0.90)
    admin.upsert_item("root", model_id="text/deepseek-v4-flash", stage="text", billing_unit="token_1m",
                      match={"direction": "in"}, purchase_price_cny=3.0)
    admin.upsert_item("root", model_id="text/deepseek-v4-flash", stage="text", billing_unit="token_1m",
                      match={"direction": "out"}, purchase_price_cny=9.0)


def test_publish_quote_and_versioning(billing: BillingServices):
    _seed_items(billing)
    assert billing.runtime.current() is None
    with pytest.raises(BillingError) as missing:
        billing.runtime.quote("happyhorse/happyhorse-1.1-video#i2v", {"resolution": "1080p"}, 5)
    assert missing.value.status_code == 503

    first = billing.price_admin.publish("root", note="first")
    assert first.version == 1 and first.item_count == 4
    billing.runtime.invalidate()
    assert billing.runtime.quote("happyhorse/happyhorse-1.1-video#i2v", {"resolution": "1080p"}, 5).credits == 265
    assert billing.runtime.quote_text("text/deepseek-v4-flash", 20_000, 5_000).credits == 5

    billing.price_admin.update_rule("root", target_markup=1.5)
    second = billing.price_admin.publish("root", note="150%")
    billing.runtime.invalidate()
    changed = {c["item_id"]: c for c in second.changes}
    assert changed["happyhorse/happyhorse-1.1-video#i2v|resolution=1080p"]["before"] == 53
    assert changed["happyhorse/happyhorse-1.1-video#i2v|resolution=1080p"]["after"] == 60
    assert billing.runtime.quote("happyhorse/happyhorse-1.1-video#i2v", {"resolution": "1080p"}, 5).credits == 300
    # settlement of an in-flight job still uses the version it was frozen under
    assert billing.runtime.at_version(1).quote("happyhorse/happyhorse-1.1-video#i2v", {"resolution": "1080p"}, 5).credits == 265
    assert [v["version"] for v in billing.price_admin.list_versions()] == [2, 1]


def test_publish_rejects_override_below_target(billing: BillingServices):
    billing.price_admin.upsert_item("root", model_id="wan/wan2.7-image#image", stage="image", billing_unit="image",
                                    match={}, purchase_price_cny=0.20, credits_override=5)
    with pytest.raises(BillingError) as error:
        billing.price_admin.publish("root")
    assert error.value.code == "PRICING_MARGIN_BELOW_TARGET"


def test_rollback_publishes_new_version_from_history(billing: BillingServices):
    admin = billing.price_admin
    admin.upsert_item("root", model_id="wan/wan2.7-image#image", stage="image", billing_unit="image", match={}, purchase_price_cny=0.20)
    admin.publish("root")
    admin.upsert_item("root", model_id="wan/wan2.7-image#image", stage="image", billing_unit="image", match={}, purchase_price_cny=0.50)
    admin.publish("root")
    result = admin.rollback("root", 1)
    billing.runtime.invalidate()
    assert result.version == 3
    assert billing.runtime.quote("wan/wan2.7-image#image", {}).credits == 9


def test_most_specific_match_wins(billing: BillingServices):
    admin = billing.price_admin
    admin.upsert_item("root", model_id="pixverse/v6#i2v", stage="video", billing_unit="second", match={"resolution": "720p"}, purchase_price_cny=0.64)
    admin.upsert_item("root", model_id="pixverse/v6#i2v", stage="video", billing_unit="second", match={"resolution": "720p", "audio": True}, purchase_price_cny=0.86)
    admin.publish("root")
    assert billing.runtime.quote("pixverse/v6#i2v", {"resolution": "720p"}).credits == 29
    assert billing.runtime.quote("pixverse/v6#i2v", {"resolution": "720p", "audio": True}).credits == 38


# ---------------------------------------------------------------- roles
def test_roles_bootstrap_and_guards(billing: BillingServices):
    roles = billing.roles
    _make_user(billing.engine, "u1")
    _make_user(billing.engine, "u2")
    assert roles.bootstrap_root("u1") is True
    assert roles.bootstrap_root("u2") is False
    roles.grant("u2", "admin", by_user_id="u1")
    assert roles.require("u1", "root") == "root"
    with pytest.raises(BillingError) as forbidden:
        roles.require("u2", "root")
    assert forbidden.value.status_code == 403
    with pytest.raises(BillingError) as last_root:
        roles.revoke("u1")
    assert last_root.value.code == "ROLE_LAST_ROOT"
    roles.grant("u2", "root", by_user_id="u1")
    roles.revoke("u1")
    assert roles.role_of("u1") is None and roles.role_of("u2") == "root"


# ---------------------------------------------------------------- wallet
def test_wallet_hold_settle_release_are_idempotent(billing: BillingServices):
    _seed_items(billing)
    billing.price_admin.publish("root")
    wallets, runtime = billing.wallets, billing.runtime
    w = wallets.for_workspace("ws1")
    assert wallets.credit(w["id"], 1000, "purchase", "order-1") is True
    assert wallets.credit(w["id"], 1000, "purchase", "order-1") is False      # replayed payment callback
    assert wallets.balance(w["id"]) == {"balance": 1000, "frozen": 0, "available": 1000}

    q = runtime.quote("happyhorse/happyhorse-1.1-video#i2v", {"resolution": "1080p"}, 5)   # 265
    assert wallets.hold(w["id"], "job-a", q) is True
    assert wallets.hold(w["id"], "job-a", q) is False
    assert wallets.balance(w["id"]) == {"balance": 1000, "frozen": 265, "available": 735}

    actual = runtime.quote("happyhorse/happyhorse-1.1-video#i2v", {"resolution": "1080p"}, 4)  # only 4 s produced
    assert wallets.settle("job-a", actual) is True
    assert wallets.settle("job-a", actual) is False
    assert wallets.balance(w["id"]) == {"balance": 788, "frozen": 0, "available": 788}

    wallets.hold(w["id"], "job-b", q)
    assert wallets.release("job-b") is True
    assert wallets.balance(w["id"]) == {"balance": 788, "frozen": 0, "available": 788}
    assert wallets.settle("never-held") is False and wallets.release("never-held") is False

    with pytest.raises(BillingError) as short:
        wallets.hold(w["id"], "job-c", runtime.quote("happyhorse/happyhorse-1.1-video#i2v", {"resolution": "1080p"}, 15))
    assert short.value.status_code == 402
    assert [e["type"] for e in wallets.ledger(w["id"])] == ["release", "hold", "settle", "hold", "purchase"]


def test_wallet_adjust_requires_reason_and_transfer_is_atomic(billing: BillingServices):
    wallets = billing.wallets
    pool = wallets.get_or_create("reseller", "r1")
    ws = wallets.for_workspace("ws9")
    wallets.credit(pool["id"], 400_000, "purchase", "reseller-order-1")
    with pytest.raises(BillingError) as no_reason:
        wallets.credit(ws["id"], -5, "adjust", "adj-1")
    assert no_reason.value.code == "REASON_REQUIRED"
    assert wallets.transfer(pool["id"], ws["id"], 5_000, "tr-1", actor_user_id="r1") is True
    assert wallets.transfer(pool["id"], ws["id"], 5_000, "tr-1", actor_user_id="r1") is False
    assert wallets.balance(pool["id"])["available"] == 395_000
    assert wallets.balance(ws["id"])["available"] == 5_000
    with pytest.raises(BillingError):
        wallets.transfer(ws["id"], pool["id"], 6_000, "tr-2", actor_user_id="x")
    assert wallets.balance(ws["id"])["available"] == 5_000
