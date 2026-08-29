from __future__ import annotations

from src.apps.comic_gen.auth.tokens import decode_access_token
from tests.auth_test_helpers import make_auth_app, make_client


def _setup_owner(client):
    response = client.post(
        "/auth/setup",
        json={
            "username": "owner",
            "email": "owner@example.com",
            "password": "correct horse battery staple",
        },
    )
    assert response.status_code == 201, response.text
    return response


def test_password_reset_status_is_available_only_after_local_setup(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as local_client:
        before = local_client.get("/auth/password-reset/status")
        assert before.status_code == 200
        assert before.json() == {"available": False, "token_required": False}

        _setup_owner(local_client)
        local = local_client.get("/auth/password-reset/status")
        assert local.status_code == 200
        assert local.json() == {"available": True, "token_required": False}

    with make_client(app, local=False) as remote_client:
        remote = remote_client.get("/auth/password-reset/status")
        assert remote.status_code == 200
        assert remote.json() == {"available": False, "token_required": False}
    engine.dispose()


def test_password_reset_rejects_remote_and_missing_csrf(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as local_client:
        _setup_owner(local_client)

    payload = {
        "identifier": "owner",
        "new_password": "a different secure passphrase",
    }
    with make_client(app, local=False) as remote_client:
        remote = remote_client.post("/auth/password-reset", json=payload)
        assert remote.status_code == 403
        assert remote.json()["error"]["code"] == "AUTH_PASSWORD_RESET_UNAVAILABLE"

    with make_client(app, local=True) as local_client:
        missing_csrf = local_client.post(
            "/auth/password-reset",
            json=payload,
            headers={"X-CSRF-Token": ""},
        )
        assert missing_csrf.status_code == 403
        assert missing_csrf.json()["error"]["code"] == "AUTH_CSRF_FAILED"
    engine.dispose()


def test_password_reset_token_is_required_when_configured(tmp_path):
    recovery_token = "reset-token-012345678901234567890123456789"
    app, engine, _ = make_auth_app(tmp_path, password_reset_token=recovery_token)
    with make_client(app, local=True) as client:
        _setup_owner(client)
        status = client.get("/auth/password-reset/status")
        assert status.json() == {"available": True, "token_required": True}

        payload = {
            "identifier": "owner",
            "new_password": "a different secure passphrase",
        }
        missing = client.post("/auth/password-reset", json=payload)
        wrong = client.post(
            "/auth/password-reset",
            json={**payload, "recovery_token": "wrong-token"},
        )
        for response in (missing, wrong):
            assert response.status_code == 400
            assert response.json()["error"]["code"] == "AUTH_PASSWORD_RESET_FAILED"

        success = client.post(
            "/auth/password-reset",
            json={**payload, "recovery_token": recovery_token},
        )
        assert success.status_code == 200, success.text
        assert success.json() == {
            "password_reset": True,
            "reauthentication_required": True,
        }
    engine.dispose()


def test_password_reset_changes_password_and_revokes_all_sessions(tmp_path):
    app, engine, service = make_auth_app(tmp_path)
    with make_client(app, local=True) as first_client:
        setup = _setup_owner(first_client)
        first_access = setup.json()["access_token"]

        with make_client(app, local=True) as second_client:
            login = second_client.post(
                "/auth/login",
                json={
                    "identifier": "owner",
                    "password": "correct horse battery staple",
                },
            )
            assert login.status_code == 200, login.text
            second_access = login.json()["access_token"]

            with make_client(app, local=True) as reset_client:
                reset_client.get("/auth/password-reset/status")
                reset = reset_client.post(
                    "/auth/password-reset",
                    json={
                        "identifier": "owner@example.com",
                        "new_password": "a different secure passphrase",
                    },
                )
                assert reset.status_code == 200, reset.text

            for access in (first_access, second_access):
                first_client.cookies.clear()
                expired = first_client.get(
                    "/auth/me",
                    headers={"Authorization": f"Bearer {access}"},
                )
                assert expired.status_code == 401

            first_client.cookies.clear()
            old_login = first_client.post(
                "/auth/login",
                json={
                    "identifier": "owner",
                    "password": "correct horse battery staple",
                },
            )
            assert old_login.status_code == 401

            new_login = first_client.post(
                "/auth/login",
                json={
                    "identifier": "owner",
                    "password": "a different secure passphrase",
                },
            )
            assert new_login.status_code == 200, new_login.text

            for access in (first_access, second_access):
                session_id = decode_access_token(
                    access,
                    service.settings.signing_secret,
                    issuer=service.settings.issuer,
                    audience=service.settings.audience,
                )["sid"]
                session = service.repository.get_session(session_id)
                assert session is not None
                assert session.revoked_at is not None
                assert session.revoke_reason == "password_reset"
    engine.dispose()


def test_password_reset_does_not_reveal_unknown_identifier_and_enforces_policy(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        _setup_owner(client)
        client.get("/auth/password-reset/status")

        unknown = client.post(
            "/auth/password-reset",
            json={
                "identifier": "missing@example.com",
                "new_password": "a different secure passphrase",
            },
        )
        assert unknown.status_code == 400
        assert unknown.json()["error"]["code"] == "AUTH_PASSWORD_RESET_FAILED"
        assert "missing" not in unknown.text

        policy = client.post(
            "/auth/password-reset",
            json={"identifier": "owner", "new_password": "owner@example.com"},
        )
        assert policy.status_code == 422
        assert policy.json()["error"]["code"] == "AUTH_PASSWORD_POLICY"
    engine.dispose()
