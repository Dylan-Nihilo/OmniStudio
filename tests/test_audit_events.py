from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.pool import StaticPool

from src.apps.comic_gen import audit
from src.storage.db import create_engine, init_schema
from src.storage.schema import User, Workspace
from tests.auth_test_helpers import make_auth_app, make_client


def _engine_with_workspace():
    engine = create_engine(
        ":memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    init_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            User.__table__.insert(),
            {
                "id": "user-1",
                "username": "owner",
                "username_normalized": "owner",
                "email": "owner@example.com",
                "email_normalized": "owner@example.com",
                "password_hash": "hash",
                "created_at": 1.0,
                "updated_at": 1.0,
                "metadata_json": "{}",
            },
        )
        connection.execute(
            Workspace.__table__.insert(),
            {
                "id": "workspace-1",
                "owner_user_id": "user-1",
                "name": "Acceptance",
                "slug": "acceptance",
                "created_at": 1.0,
                "updated_at": 1.0,
                "metadata_json": "{}",
            },
        )
    return engine


def test_audit_record_redacts_credentials_and_absolute_paths():
    engine = _engine_with_workspace()
    try:
        event = audit.record(
            engine=engine,
            actor_user_id="user-1",
            workspace_id="workspace-1",
            action="provider.config.update",
            object_type="workspace",
            object_id="workspace-1",
            metadata={
                "DASHSCOPE_API_KEY": "secret-value",
                "config_path": r"C:\Users\owner\private.env",
                "changed": ["OPENAI_MODEL"],
            },
        )

        assert event.workspace_id == "workspace-1"
        assert event.metadata["DASHSCOPE_API_KEY"] == "[REDACTED]"
        assert event.metadata["config_path"] == "[REDACTED_PATH]"
        assert event.metadata["changed"] == ["OPENAI_MODEL"]

        stored = audit.list_events(engine=engine, workspace_id="workspace-1")
        assert len(stored) == 1
        assert json.dumps(stored[0].metadata, ensure_ascii=False).find("secret-value") == -1
    finally:
        engine.dispose()


def test_audit_events_are_workspace_scoped():
    engine = _engine_with_workspace()
    try:
        audit.record(
            engine=engine,
            actor_user_id="user-1",
            workspace_id="workspace-1",
            action="project.delete",
            object_type="project",
            object_id="project-1",
            metadata={},
        )
        assert audit.list_events(engine=engine, workspace_id="workspace-other") == []
    finally:
        engine.dispose()


def test_setup_and_login_write_workspace_audit_events(tmp_path: Path):
    app, engine, _ = make_auth_app(tmp_path)
    try:
        with make_client(app, local=True) as client:
            setup = client.post(
                "/auth/setup",
                json={
                    "username": "owner",
                    "email": "owner@example.com",
                    "password": "correct horse battery staple",
                },
            )
            assert setup.status_code == 201, setup.text
            client.post("/auth/logout")
            login = client.post(
                "/auth/login",
                json={
                    "identifier": "owner",
                    "password": "correct horse battery staple",
                },
            )
            assert login.status_code == 200, login.text

        actions = [
            event.action
            for event in audit.list_events(
                engine=engine,
                workspace_id=setup.json()["workspace"]["id"],
            )
        ]
        assert "auth.setup" in actions
        assert "auth.login" in actions
        assert "auth.logout" in actions
    finally:
        engine.dispose()
