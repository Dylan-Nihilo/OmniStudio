from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import text

from tests.auth_test_helpers import make_auth_app, make_client


def payload(username="owner", email="owner@example.com", password="correct horse battery staple", **extra):
    value = {"username": username, "email": email, "password": password}
    value.update(extra)
    return value


def test_empty_database_setup_creates_owner_workspace_session(tmp_path):
    app, engine, service = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        status = client.get("/auth/setup-status")
        assert status.status_code == 200
        assert status.json() == {
            "initialized": False,
            "setup_allowed": True,
            "setup_token_required": False,
        }

        response = client.post("/auth/setup", json=payload(display_name="LumenX Owner"))
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["access_token"] and body["refresh_token"]
        assert body["user"]["username"] == "owner"
        assert body["user"]["display_name"] == "LumenX Owner"
        assert body["workspace"]["slug"] == "default"
        assert "lumenx_access=" in response.headers["set-cookie"]
        assert "lumenx_refresh=" in response.headers["set-cookie"]

    with engine.connect() as connection:
        assert connection.scalar(text("SELECT COUNT(*) FROM users")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM workspaces")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM sessions")) == 1
    engine.dispose()


def test_repeated_setup_is_rejected(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        assert client.post("/auth/setup", json=payload()).status_code == 201
        response = client.post("/auth/setup", json=payload(username="another", email="another@example.com"))
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "AUTH_ALREADY_INITIALIZED"
    engine.dispose()


def test_remote_setup_without_token_is_rejected(tmp_path):
    app, engine, _ = make_auth_app(tmp_path, setup_token=None)
    with make_client(app, local=False) as client:
        response = client.post("/auth/setup", json=payload())
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "AUTH_SETUP_FORBIDDEN"
    engine.dispose()


def test_remote_setup_with_matching_token_succeeds(tmp_path):
    token = "setup-token-012345678901234567890123456789"
    app, engine, _ = make_auth_app(tmp_path, setup_token=token)
    with make_client(app, local=False) as client:
        status = client.get("/auth/setup-status")
        assert status.json() == {
            "initialized": False,
            "setup_allowed": True,
            "setup_token_required": True,
        }
        response = client.post("/auth/setup", json=payload(setup_token=token))
        assert response.status_code == 201, response.text
    engine.dispose()


def test_remote_forwarded_headers_do_not_make_request_local(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        response = client.post("/auth/setup", headers={"X-Forwarded-For": "127.0.0.1"}, json=payload())
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "AUTH_SETUP_FORBIDDEN"
    engine.dispose()


def test_concurrent_setup_allows_at_most_one_success(tmp_path):
    app, engine, _ = make_auth_app(tmp_path, setup_token="setup-token-012345678901234567890123456789")

    def submit(index: int):
        with make_client(app, local=False) as client:
            return client.post(
                "/auth/setup",
                json=payload(
                    username=f"owner{index}",
                    email=f"owner{index}@example.com",
                    setup_token="setup-token-012345678901234567890123456789",
                ),
            )

    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(submit, range(4)))
    statuses = [response.status_code for response in responses]
    assert statuses.count(201) == 1
    assert statuses.count(409) == 3
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT COUNT(*) FROM users")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM workspaces")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM sessions")) == 1
    engine.dispose()
