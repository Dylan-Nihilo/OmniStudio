from __future__ import annotations

import time

import pytest

from src.apps.comic_gen.auth.csrf import issue_csrf_token, verify_csrf
from src.apps.comic_gen.auth.passwords import (
    hash_password,
    password_needs_rehash,
    verify_password,
)
from src.apps.comic_gen.auth.tokens import (
    decode_access_token,
    decode_refresh_token,
    hash_refresh_token,
    issue_access_token,
    issue_refresh_token,
)
from tests.auth_test_helpers import make_auth_app, make_client


@pytest.mark.parametrize("password", ["correct horse battery staple", "中文密码"])
def test_argon2_password_round_trip(password: str):
    encoded = hash_password(password)
    assert encoded.startswith("$argon2id$")
    assert verify_password(password, encoded) is True
    assert verify_password("wrong password", encoded) is False
    assert password_needs_rehash(encoded) is False


def test_missing_password_hash_still_fails_as_a_password_check():
    assert verify_password("anything", None) is False
    assert password_needs_rehash(None) is True


def test_jwt_access_and_refresh_round_trip_and_type_separation():
    secret = "s" * 32
    now = time.time()
    access = issue_access_token("user-1", "session-1", secret, now=now)
    refresh = issue_refresh_token("user-1", "session-1", secret, now=now, rotation_counter=0)
    assert decode_access_token(access, secret)["type"] == "access"
    assert decode_refresh_token(refresh, secret)["type"] == "refresh"
    with pytest.raises(Exception):
        decode_access_token(refresh, secret)
    with pytest.raises(Exception):
        decode_refresh_token(access, secret)


def test_jwt_rejects_expired_wrong_issuer_and_wrong_audience():
    secret = "s" * 32
    expired = issue_access_token("u", "s", secret, ttl_seconds=1, now=time.time() - 1000)
    with pytest.raises(Exception):
        decode_access_token(expired, secret)
    wrong_issuer = issue_access_token("u", "s", secret, issuer="other", now=time.time())
    with pytest.raises(Exception):
        decode_access_token(wrong_issuer, secret)
    wrong_audience = issue_access_token("u", "s", secret, audience="other", now=time.time())
    with pytest.raises(Exception):
        decode_access_token(wrong_audience, secret)



def test_csrf_token_is_session_bound_and_expires_after_window_grace():
    secret = "s" * 32
    token = issue_csrf_token("session-1", secret, now=3600, window_seconds=60)
    assert verify_csrf(token, "session-1", secret, now=3600, window_seconds=60) is True
    assert verify_csrf(token, "session-2", secret, now=3600, window_seconds=60) is False
    assert verify_csrf(token, "session-1", secret, now=3721, window_seconds=60) is False


def test_refresh_hash_is_prefixed_sha256_and_deterministic():
    token = "eyJhbGciOiJIUzI1NiJ9.payload.signature"
    digest = hash_refresh_token(token)
    assert digest == hash_refresh_token(token)
    assert digest.startswith("sha256:")
    assert len(digest) == len("sha256:") + 64



def _owner(client):
    response = client.post("/auth/setup", json={"username": "owner", "email": "owner@example.com", "password": "correct horse battery staple"})
    assert response.status_code == 201, response.text
    return response


def test_csrf_missing_and_wrong_token_are_rejected(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        _owner(client)
        csrf = client.cookies.get("omni_studio_csrf")
        missing = client.post("/auth/logout", headers={"X-CSRF-Token": ""})
        assert missing.status_code == 403
        assert missing.json()["error"]["code"] == "AUTH_CSRF_FAILED"
        wrong = client.post("/auth/logout", headers={"X-CSRF-Token": "wrong-token"})
        assert wrong.status_code == 403
        assert csrf
    engine.dispose()


def test_csrf_origin_must_be_exactly_allowlisted(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        _owner(client)
        csrf = client.cookies.get("omni_studio_csrf")
        response = client.post("/auth/logout", headers={"Origin": "https://evil.example", "X-CSRF-Token": csrf})
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "AUTH_CSRF_FAILED"
    engine.dispose()


def test_logout_revokes_session_clears_cookies_and_old_access_fails(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup = _owner(client)
        old_access = setup.json()["access_token"]

        response = client.post("/auth/logout")
        assert response.status_code == 204
        set_cookie = "\n".join(response.headers.get_list("set-cookie")).lower()
        for cookie_name in ("omni_studio_access", "omni_studio_refresh", "omni_studio_csrf"):
            assert f"{cookie_name}=" in set_cookie
            assert "max-age=0" in set_cookie

        client.cookies.clear()
        old_me = client.get("/auth/me", headers={"Authorization": f"Bearer {old_access}"})
        assert old_me.status_code == 401
        assert old_me.json()["error"]["code"] == "AUTH_SESSION_INVALID"
    engine.dispose()


def test_change_password_revokes_old_session_and_requires_reauthentication(tmp_path):
    app, engine, service = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup = _owner(client)
        old_access = setup.json()["access_token"]
        csrf = client.cookies.get("omni_studio_csrf")
        response = client.post("/auth/change-password", json={"current_password": "correct horse battery staple", "new_password": "a newer and longer passphrase"}, headers={"X-CSRF-Token": csrf})
        assert response.status_code == 200, response.text
        assert response.json()["reauthentication_required"] is True
        client.cookies.clear()
        old_me = client.get("/auth/me", headers={"Authorization": f"Bearer {old_access}"})
        assert old_me.status_code == 401

        login = client.post("/auth/login", json={"identifier": "owner", "password": "a newer and longer passphrase"})
        assert login.status_code == 200, login.text
        session_id = decode_access_token(old_access, service.settings.signing_secret, issuer=service.settings.issuer, audience=service.settings.audience)["sid"]
        assert service.repository.get_session(session_id).revoked_at is not None
    engine.dispose()
