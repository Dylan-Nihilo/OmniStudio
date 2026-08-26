from __future__ import annotations

from tests.auth_test_helpers import make_auth_app, make_client
from src.apps.comic_gen.auth.passwords import hash_password
from src.storage.auth_repository import AuthRepository


def payload(identifier="owner", password="correct horse battery staple"):
    return {"identifier": identifier, "password": password}


def setup_owner(client):
    response = client.post(
        "/auth/setup",
        json={
            "username": "Owner",
            "email": "OWNER@example.com",
            "password": "correct horse battery staple",
            "display_name": "Owner",
        },
    )
    assert response.status_code == 201, response.text
    return response


def test_login_with_username_and_email_succeeds(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup_owner(client)
        client.cookies.clear()
        by_username = client.post("/auth/login", json=payload("owner"))
        assert by_username.status_code == 200, by_username.text
        assert by_username.json()["user"]["username"] == "Owner"
        client.cookies.clear()
        by_email = client.post("/auth/login", json=payload(" owner@example.com "))
        assert by_email.status_code == 200, by_email.text
        assert by_email.json()["workspace"]["slug"] == "default"
        assert "lumenx_access=" in by_email.headers["set-cookie"]
    engine.dispose()


def test_wrong_password_has_same_public_error_for_existing_and_missing_user(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup_owner(client)
        client.cookies.clear()
        existing = client.post("/auth/login", json=payload("owner", "wrong password"))
        client.cookies.clear()
        missing = client.post("/auth/login", json=payload("missing", "wrong password"))
        assert existing.status_code == missing.status_code == 401
        assert existing.json()["error"]["code"] == missing.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"
        assert existing.json()["error"]["message"] == missing.json()["error"]["message"]
    engine.dispose()


def test_login_then_me_returns_current_user(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup_owner(client)
        client.cookies.clear()
        login = client.post("/auth/login", json=payload("owner"))
        assert login.status_code == 200
        me = client.get("/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["user"]["email"] == "OWNER@example.com"
        assert me.json()["workspace"]["slug"] == "default"
    engine.dispose()
