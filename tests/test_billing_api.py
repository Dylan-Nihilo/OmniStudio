"""Billing HTTP surface: root bootstrap on setup, admin console guards, user wallet/quote endpoints."""

from __future__ import annotations

from pathlib import Path

from src.billing import BillingError, BillingServices
from src.billing.routes import admin_router, billing_exception_handler, router
from tests.auth_test_helpers import make_auth_app, make_client

PASSWORD = "correct horse battery staple"


def _make_app(tmp_path: Path):
    app, engine, service = make_auth_app(tmp_path)
    app.add_exception_handler(BillingError, billing_exception_handler)
    app.include_router(router)
    app.include_router(admin_router)
    app.state.billing = BillingServices.build(engine)
    return app, engine, service


def _setup_owner(client) -> dict:
    response = client.post("/auth/setup", json={"username": "owner", "email": "owner@example.com", "password": PASSWORD})
    assert response.status_code == 201, response.text
    return response.json()


def _invite_member(client, workspace_id: str, username: str) -> None:
    """Register a second user through the invitation flow; the client ends up logged in as that member."""
    invite = client.post(f"/auth/workspaces/{workspace_id}/invitations", json={"email": f"{username}@example.com"})
    assert invite.status_code == 201, invite.text
    token = invite.json()["token"]
    client.post("/auth/logout")
    registered = client.post("/auth/invitations/register", json={
        "token": token, "username": username, "email": f"{username}@example.com", "password": PASSWORD})
    assert registered.status_code == 201, registered.text


def test_setup_user_becomes_root_and_admin_routes_are_guarded(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OMNI_STUDIO_BILLING_ENABLED", "1")
    app, engine, service = _make_app(tmp_path)
    with make_client(app, local=True) as client:
        _setup_owner(client)
        me = client.get("/billing/wallet").json()
        assert me["role"] == "root" and me["available"] == 0 and me["enabled"] is True

        rule = client.get("/admin/pricing/rule").json()
        assert rule["credits_per_yuan"] == 44.0

        preview = client.post("/admin/pricing/preview", json={"purchase_price_cny": 1.2}).json()
        assert preview == {**preview, "credits": 53, "meets_target": True}

        item = client.put("/admin/pricing/items", json={
            "model_id": "happyhorse/happyhorse-1.1-video#i2v", "stage": "video", "billing_unit": "second",
            "match": {"resolution": "1080p"}, "purchase_price_cny": 1.2, "display_name": "快乐马 1080p"}).json()
        assert item["credits"] == 53

        before_publish = client.post("/billing/quote", json={"model_id": "happyhorse/happyhorse-1.1-video#i2v",
                                                             "params": {"resolution": "1080p"}, "quantity": 5})
        assert before_publish.status_code == 503
        assert before_publish.json()["error"]["code"] == "PRICE_BOOK_MISSING"

        published = client.post("/admin/pricing/publish", json={"note": "v1"}).json()
        assert published["version"] == 1 and published["changes"][0]["after"] == 53

        quote = client.post("/billing/quote", json={"model_id": "happyhorse/happyhorse-1.1-video#i2v",
                                                    "params": {"resolution": "1080p"}, "quantity": 5}).json()
        assert quote["credits"] == 265 and quote["price_book_version"] == 1

        table = client.get("/billing/pricing-table").json()
        assert table["version"] == 1 and table["items"][0]["credits"] == 53
        assert "purchase_price_cny" not in table["items"][0]

        # root changes the ratio; draft table comes back recomputed, quotes only change after publish
        updated = client.put("/admin/pricing/rule", json={"target_markup": 1.5}).json()
        assert updated["credits_per_yuan"] == 50.0 and updated["draft_table"][0]["credits"] == 60
        assert client.post("/billing/quote", json={"model_id": "happyhorse/happyhorse-1.1-video#i2v",
                                                   "params": {"resolution": "1080p"}, "quantity": 5}).json()["credits"] == 265
        client.post("/admin/pricing/publish", json={"note": "v2"})
        assert client.post("/billing/quote", json={"model_id": "happyhorse/happyhorse-1.1-video#i2v",
                                                   "params": {"resolution": "1080p"}, "quantity": 5}).json()["credits"] == 300

        versions = client.get("/admin/pricing/versions").json()
        assert [v["version"] for v in versions] == [2, 1]

        # manual grant into the owner's workspace wallet
        wallet_id = me["wallet_id"]
        granted = client.post("/admin/wallets/grant", json={"workspace_id": me["workspace_id"], "amount": 500,
                                                            "reason": "线下充值"}).json()
        assert granted["available"] == 500
        adjusted = client.post("/admin/wallets/adjust", json={"wallet_id": wallet_id, "amount": -100,
                                                              "reason": "测试扣回"}).json()
        assert adjusted["available"] == 400
        ledger = client.get("/billing/ledger").json()["entries"]
        assert [entry["type"] for entry in ledger] == ["adjust", "grant"]

        # a second user (member) has no platform role and is rejected by the admin console
        _invite_member(client, me["workspace_id"], "member")
        assert client.get("/billing/wallet").json()["role"] is None
        forbidden = client.get("/admin/pricing/rule")
        assert forbidden.status_code == 403 and forbidden.json()["error"]["code"] == "BILLING_FORBIDDEN"
        assert client.put("/admin/pricing/rule", json={"target_markup": 0}).status_code == 403


def test_publish_blocks_below_target_and_reports_error_envelope(tmp_path: Path):
    app, _, _ = _make_app(tmp_path)
    with make_client(app, local=True) as client:
        _setup_owner(client)
        client.put("/admin/pricing/items", json={"model_id": "wan/wan2.7-image#image", "stage": "image",
                                                 "billing_unit": "image", "purchase_price_cny": 0.2, "credits_override": 5})
        response = client.post("/admin/pricing/publish", json={})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "PRICING_MARGIN_BELOW_TARGET"
        assert client.post("/admin/pricing/preview", json={"purchase_price_cny": -1}).status_code == 422


def test_wallet_hides_itself_while_billing_is_switched_off(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("OMNI_STUDIO_BILLING_ENABLED", raising=False)
    app, _, _ = _make_app(tmp_path)
    with make_client(app, local=True) as client:
        me = _setup_owner(client) and client.get("/billing/wallet").json()
        # root still gets a wallet and its role: that is how prices get configured before go-live
        assert me["enabled"] is False and me["role"] == "root" and me["available"] == 0

        _invite_member(client, me["workspace_id"], "member")
        member = client.get("/billing/wallet").json()
        assert member == {"enabled": False, "role": None}
