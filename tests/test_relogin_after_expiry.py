"""Regression: re-login after session expiry must not 403 on CSRF binding.

A browser that logged in once carries a session-bound CSRF cookie. After the
session is revoked/expired server-side the cookie remains; login must accept
that binding (in addition to the preauth binding) so the second login works.
"""
import time

from sqlalchemy import text

from tests.auth_test_helpers import make_auth_app, make_client


def test_relogin_after_session_revocation_does_not_403(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)

    with make_client(app, local=True) as client:
        # Create the owner (setup) first.
        r_setup = client.post(
            "/auth/setup",
            json={"username": "owner", "email": "owner@example.com", "password": "supersecret1"},
        )
        assert r_setup.status_code == 201, r_setup.text
        # First login: preauth CSRF from setup-status is accepted.
        r0 = client.get("/auth/setup-status")
        assert r0.status_code == 200
        csrf0 = client.cookies.get("lumenx_csrf")
        r1 = client.post(
            "/auth/login",
            json={"identifier": "owner", "password": "supersecret1"},
        )
        assert r1.status_code == 200, r1.text

        # Revoke all sessions server-side; browser cookie jar is untouched.
        with engine.connect() as c:
            c.execute(text("UPDATE sessions SET revoked_at=:now WHERE revoked_at IS NULL"), {"now": time.time()})
            c.commit()

        r401 = client.get("/auth/me")
        assert r401.status_code == 401

        # Second login with the stale session-bound CSRF cookie must work.
        csrf1 = client.cookies.get("lumenx_csrf")
        r2 = client.post(
            "/auth/login",
            json={"identifier": "owner", "password": "supersecret1"},
        )
        assert r2.status_code == 200, r2.text
        assert csrf0 is not None and csrf1 is not None


def test_setup_status_refresh_preserves_authenticated_csrf_binding(tmp_path):
    """Reload bootstrap must not turn an authenticated browser read-only."""
    app, engine, _ = make_auth_app(tmp_path)

    try:
        with make_client(app, local=True) as client:
            setup = client.post(
                "/auth/setup",
                json={
                    "username": "owner",
                    "email": "owner@example.com",
                    "password": "supersecret1",
                },
            )
            assert setup.status_code == 201

            refreshed_status = client.get("/auth/setup-status")
            assert refreshed_status.status_code == 200

            logout = client.post("/auth/logout")
            assert logout.status_code == 204, logout.text
    finally:
        engine.dispose()
