from __future__ import annotations

from tests.auth_test_helpers import make_auth_app, make_client


OWNER = {
    "username": "owner",
    "email": "owner@example.com",
    "password": "correct horse battery staple",
}


def _invite_owner(app, email: str, *, access_role: str):
    client = make_client(app, local=True)
    setup = client.post("/auth/setup", json=OWNER)
    assert setup.status_code == 201, setup.text
    workspace_id = setup.json()["workspace"]["id"]
    invitation = client.post(
        f"/auth/workspaces/{workspace_id}/invitations",
        json={"email": email, "access_role": access_role},
    )
    assert invitation.status_code == 201, invitation.text
    token = invitation.json()["token"]
    client.close()
    return workspace_id, token


def test_invitation_can_assign_viewer_access_role(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    try:
        workspace_id, token = _invite_owner(app, "viewer@example.com", access_role="viewer")
        with make_client(app) as viewer:
            registered = viewer.post(
                "/auth/invitations/register",
                headers={"Origin": "http://testserver", "X-CSRF-Token": viewer.cookies.get("omni_studio_csrf")},
                json={
                    "token": token,
                    "username": "viewer",
                    "email": "viewer@example.com",
                    "password": "viewer password 123",
                },
            )
            assert registered.status_code == 201, registered.text
            me = viewer.get("/auth/me")
            assert me.status_code == 200, me.text
            roles = {item["id"]: item["role"] for item in me.json()["workspaces"]}
            assert roles[workspace_id] == "viewer"
    finally:
        engine.dispose()


def test_owner_can_change_member_access_role(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    try:
        workspace_id, token = _invite_owner(app, "writer@example.com", access_role="editor")
        with make_client(app) as writer:
            registered = writer.post(
                "/auth/invitations/register",
                json={
                    "token": token,
                    "username": "writer",
                    "email": "writer@example.com",
                    "password": "writer password 123",
                },
            )
            assert registered.status_code == 201, registered.text
            writer_id = registered.json()["user"]["id"]

        with make_client(app, local=True) as owner:
            login = owner.post("/auth/login", json={"identifier": OWNER["username"], "password": OWNER["password"]})
            assert login.status_code == 200, login.text
            changed = owner.patch(
                f"/auth/workspaces/{workspace_id}/members/{writer_id}",
                json={"access_role": "viewer"},
            )
            assert changed.status_code == 200, changed.text
            assert changed.json()["role"] == "viewer"
    finally:
        engine.dispose()


def test_viewer_cannot_mutate_business_routes(tmp_path):
    from fastapi.testclient import TestClient
    from src.apps.comic_gen import api as api_module
    from src.apps.comic_gen.auth.settings import AuthSettings
    from src.apps.comic_gen.auth.service import AuthService
    from src.storage.auth_repository import AuthRepository
    from src.storage.db import create_engine, init_schema

    engine = create_engine(tmp_path / "full-role.db")
    init_schema(engine)
    settings = AuthSettings(
        signing_secret="test-signing-secret-012345678901234567890123456789",
        allowed_origins=("http://testserver",),
        app_env="test",
    )
    previous_service = api_module.app.state.auth_service
    previous_settings = api_module.app.state.auth_settings
    api_module.app.state.auth_service = AuthService(AuthRepository(engine), settings)
    api_module.app.state.auth_settings = settings
    try:
        with TestClient(api_module.app, client=("127.0.0.1", 41000), raise_server_exceptions=False) as owner:
            owner.get("/auth/setup-status")
            setup = owner.post(
                "/auth/setup",
                headers={"Origin": "http://testserver", "X-CSRF-Token": owner.cookies.get("omni_studio_csrf")},
                json=OWNER,
            )
            assert setup.status_code == 201, setup.text
            workspace_id = setup.json()["workspace"]["id"]
            invitation = owner.post(
                f"/auth/workspaces/{workspace_id}/invitations",
                headers={"Origin": "http://testserver", "X-CSRF-Token": owner.cookies.get("omni_studio_csrf")},
                json={"email": "viewer@example.com", "access_role": "viewer"},
            )
            assert invitation.status_code == 201, invitation.text

        with TestClient(api_module.app, client=("198.51.100.20", 41000), raise_server_exceptions=False) as viewer:
            viewer.get("/auth/setup-status")
            csrf = viewer.cookies.get("omni_studio_csrf")
            registered = viewer.post(
                "/auth/invitations/register",
                headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
                json={
                    "token": invitation.json()["token"],
                    "username": "viewer",
                    "email": "viewer@example.com",
                    "password": "viewer password 123",
                },
            )
            assert registered.status_code == 201, registered.text
            csrf = viewer.cookies.get("omni_studio_csrf")
            denied = viewer.post(
                "/projects",
                headers={"Origin": "http://testserver", "X-Workspace-ID": workspace_id, "X-CSRF-Token": csrf},
                json={"title": "forbidden", "text": "viewer cannot create"},
            )
            assert denied.status_code == 403, denied.text
            assert denied.json()["error"]["code"] == "AUTH_VIEWER_READ_ONLY"
    finally:
        api_module.app.state.auth_service = previous_service
        api_module.app.state.auth_settings = previous_settings
        engine.dispose()
