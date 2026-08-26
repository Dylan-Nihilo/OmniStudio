from __future__ import annotations

import time

from src.apps.comic_gen.auth.tokens import issue_access_token
from tests.auth_test_helpers import make_auth_app, make_client


def setup_owner(client):
    return client.post(
        "/auth/setup",
        json={
            "username": "owner",
            "email": "owner@example.com",
            "password": "correct horse battery staple",
        },
    )


def test_me_without_token_is_unauthorized(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        response = client.get("/auth/me")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTH_SESSION_INVALID"
    engine.dispose()


def test_me_with_invalid_or_expired_token_is_unauthorized(tmp_path):
    app, engine, service = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup = setup_owner(client)
        assert setup.status_code == 201
        client.cookies.clear()
        invalid = client.get("/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
        assert invalid.status_code == 401

        expired = issue_access_token(
            "missing-user",
            "missing-session",
            service.settings.signing_secret,
            now=time.time() - 3600,
            ttl_seconds=900,
            issuer=service.settings.issuer,
            audience=service.settings.audience,
        )
        response = client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTH_SESSION_INVALID"
    engine.dispose()


def test_cookie_and_header_mismatch_is_bad_request(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup = setup_owner(client)
        assert setup.status_code == 201
        cookie_token = setup.json()["access_token"]
        response = client.get("/auth/me", headers={"Authorization": "Bearer different-token"})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "AUTH_AMBIGUOUS_CREDENTIALS"
        assert cookie_token
    engine.dispose()


def test_cookie_and_bearer_access_are_supported(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup = setup_owner(client)
        assert setup.status_code == 201
        cookie_me = client.get("/auth/me")
        assert cookie_me.status_code == 200
        token = setup.json()["access_token"]
        client.cookies.clear()
        bearer_me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert bearer_me.status_code == 200
    engine.dispose()
