from __future__ import annotations

import time

from src.apps.comic_gen.auth.csrf import issue_csrf_token
from src.apps.comic_gen.auth.dependencies import REFRESH_COOKIE_NAME
from src.apps.comic_gen.auth.tokens import decode_refresh_token, issue_refresh_token
from tests.auth_test_helpers import make_auth_app, make_client


PASSWORD = "correct horse battery staple"


def _setup(client):
    response = client.post("/auth/setup", json={"username": "owner", "email": "owner@example.com", "password": PASSWORD})
    assert response.status_code == 201, response.text
    return response


def test_refresh_rotates_and_replayed_old_token_revokes_family(tmp_path):
    app, engine, service = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup = _setup(client)
        old_refresh = setup.json()["refresh_token"]
        first = client.post("/auth/refresh")
        assert first.status_code == 200, first.text
        new_refresh = client.cookies.get(REFRESH_COOKIE_NAME)
        assert new_refresh and new_refresh != old_refresh
        new_payload = decode_refresh_token(
            new_refresh,
            service.settings.signing_secret,
            issuer=service.settings.issuer,
            audience=service.settings.audience,
        )
        assert new_payload["rot"] == 1
        assert service.repository.get_session(new_payload["sid"]).rotation_counter == 1

        # Replay the old token.  The same session id and CSRF binding are used,
        # so this exercises the refresh CAS/reuse path rather than CSRF.
        client.cookies.set(REFRESH_COOKIE_NAME, old_refresh, path="/auth")
        replay = client.post("/auth/refresh")
        assert replay.status_code == 401
        assert replay.json()["error"]["code"] == "AUTH_SESSION_INVALID"

        session_id = decode_refresh_token(new_refresh, service.settings.signing_secret, issuer=service.settings.issuer, audience=service.settings.audience)["sid"]
        # The replacement token must also be dead after family revocation.
        client.cookies.set(REFRESH_COOKIE_NAME, new_refresh, path="/auth")
        csrf = issue_csrf_token(session_id, service.settings.signing_secret)
        client.cookies.set("lumenx_csrf", csrf, path="/")
        dead = client.post("/auth/refresh", headers={"X-CSRF-Token": csrf})
        assert dead.status_code == 401
        assert service.repository.get_session(session_id).revoked_at is not None
    engine.dispose()


def test_expired_refresh_is_rejected_and_cookies_are_cleared(tmp_path):
    app, engine, service = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup = _setup(client)
        payload = decode_refresh_token(setup.json()["refresh_token"], service.settings.signing_secret, issuer=service.settings.issuer, audience=service.settings.audience)
        expired = issue_refresh_token(payload["sub"], payload["sid"], service.settings.signing_secret, rotation_counter=payload["rot"], now=time.time() - 3600, ttl_seconds=1, expires_at=time.time() - 3599, issuer=service.settings.issuer, audience=service.settings.audience)
        client.cookies.set(REFRESH_COOKIE_NAME, expired, path="/auth")
        response = client.post("/auth/refresh")
        assert response.status_code == 401
        set_cookie = "\n".join(response.headers.get_list("set-cookie")).lower()
        for cookie_name in ("lumenx_access", "lumenx_refresh", "lumenx_csrf"):
            assert f"{cookie_name}=" in set_cookie
            assert "max-age=0" in set_cookie
    engine.dispose()
