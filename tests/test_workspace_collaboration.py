from __future__ import annotations

from sqlalchemy import select

from src.storage.schema import WorkspaceMembership
from tests.auth_test_helpers import make_auth_app, make_client


OWNER = {
    "username": "owner",
    "email": "owner@example.com",
    "password": "correct horse battery staple",
}


def test_invitation_registration_creates_personal_owner_and_team_member(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    try:
        with make_client(app, local=True) as owner:
            setup = owner.post("/auth/setup", json=OWNER)
            assert setup.status_code == 201, setup.text
            team_id = setup.json()["workspace"]["id"]

            invitation = owner.post(
                f"/auth/workspaces/{team_id}/invitations",
                json={"email": "writer@example.com"},
            )
            assert invitation.status_code == 201, invitation.text
            invitation_token = invitation.json()["token"]

        with make_client(app) as writer:
            registered = writer.post(
                "/auth/invitations/register",
                json={
                    "token": invitation_token,
                    "username": "writer",
                    "email": "writer@example.com",
                    "password": "writer password 123",
                },
            )
            assert registered.status_code == 201, registered.text
            payload = registered.json()
            assert payload["workspace"]["role"] == "owner"

            me = writer.get("/auth/me")
            assert me.status_code == 200, me.text
            roles = {item["id"]: item["role"] for item in me.json()["workspaces"]}
            assert roles[team_id] == "member"
            assert roles[payload["workspace"]["id"]] == "owner"

            with engine.connect() as connection:
                memberships = connection.execute(
                    select(
                        WorkspaceMembership.workspace_id,
                        WorkspaceMembership.role,
                    ).where(WorkspaceMembership.user_id == payload["user"]["id"])
                ).all()
            assert set(memberships) == {
                (team_id, "member"),
                (payload["workspace"]["id"], "owner"),
            }
    finally:
        engine.dispose()


def test_any_authenticated_user_can_create_owned_workspace(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    try:
        with make_client(app, local=True) as client:
            assert client.post("/auth/setup", json=OWNER).status_code == 201
            created = client.post(
                "/auth/workspaces",
                json={"name": "漫剧十人组"},
            )
            assert created.status_code == 201, created.text
            assert created.json()["role"] == "owner"

            me = client.get("/auth/me")
            assert len(me.json()["workspaces"]) == 2
    finally:
        engine.dispose()


def test_member_cannot_invite_or_remove_workspace_owner(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    try:
        with make_client(app, local=True) as owner:
            setup = owner.post("/auth/setup", json=OWNER)
            team_id = setup.json()["workspace"]["id"]
            owner_id = setup.json()["user"]["id"]
            invitation = owner.post(
                f"/auth/workspaces/{team_id}/invitations",
                json={"email": "writer@example.com"},
            ).json()

        with make_client(app) as writer:
            assert writer.post(
                "/auth/invitations/register",
                json={
                    "token": invitation["token"],
                    "username": "writer",
                    "email": "writer@example.com",
                    "password": "writer password 123",
                },
            ).status_code == 201
            forbidden = writer.post(
                f"/auth/workspaces/{team_id}/invitations",
                json={"email": "third@example.com"},
            )
            assert forbidden.status_code == 403
            assert forbidden.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        with make_client(app, local=True) as owner:
            owner.get("/auth/setup-status")
            login = owner.post(
                "/auth/login",
                json={"identifier": OWNER["username"], "password": OWNER["password"]},
            )
            assert login.status_code == 200
            cannot_remove_owner = owner.delete(
                f"/auth/workspaces/{team_id}/members/{owner_id}"
            )
            assert cannot_remove_owner.status_code == 409
    finally:
        engine.dispose()


def test_existing_user_can_accept_invitation_to_another_workspace(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    try:
        with make_client(app, local=True) as owner:
            first = owner.post("/auth/setup", json=OWNER).json()["workspace"]
            initial_invite = owner.post(
                f"/auth/workspaces/{first['id']}/invitations",
                json={"email": "writer@example.com"},
            ).json()

        with make_client(app) as writer:
            registered = writer.post(
                "/auth/invitations/register",
                json={
                    "token": initial_invite["token"],
                    "username": "writer",
                    "email": "writer@example.com",
                    "password": "writer password 123",
                },
            )
            assert registered.status_code == 201

        with make_client(app, local=True) as owner:
            owner.post(
                "/auth/login",
                json={"identifier": OWNER["username"], "password": OWNER["password"]},
            )
            second = owner.post("/auth/workspaces", json={"name": "第二团队"}).json()
            second_invite = owner.post(
                f"/auth/workspaces/{second['id']}/invitations",
                json={"email": "writer@example.com"},
            )
            assert second_invite.status_code == 201, second_invite.text

        with make_client(app) as writer:
            writer.post(
                "/auth/login",
                json={"identifier": "writer", "password": "writer password 123"},
            )
            accepted = writer.post(
                "/auth/invitations/accept",
                json={"token": second_invite.json()["token"]},
            )
            assert accepted.status_code == 200, accepted.text
            assert accepted.json()["id"] == second["id"]
            assert accepted.json()["role"] == "member"
    finally:
        engine.dispose()
