from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import inspect, text

from src.storage.db import SCHEMA_VERSION, create_engine, init_schema
from src.storage.errors import MigrationError
from src.storage.migrations.w3_auth import migrate_w1_to_w3


def _make_w1_db(path: Path, *, with_user: bool = False):
    engine = create_engine(path)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE schema_migrations (
                version TEXT PRIMARY KEY NOT NULL,
                applied_at REAL NOT NULL,
                checksum TEXT NOT NULL,
                description TEXT NOT NULL
            )
            """
        )
        connection.exec_driver_sql(
            """
            INSERT INTO schema_migrations VALUES ('w1.1', 1.0, 'w1', 'W1.1')
            """
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE users (
                id TEXT PRIMARY KEY NOT NULL,
                email TEXT UNIQUE,
                display_name TEXT,
                password_hash TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE workspaces (
                id TEXT PRIMARY KEY NOT NULL,
                owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                slug TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                UNIQUE(owner_user_id, slug)
            )
            """
        )
        if with_user:
            connection.exec_driver_sql(
                "INSERT INTO users VALUES ('u1', 'owner@example.com', 'Owner', 'legacy', 1, 1, '{}')"
            )
    return engine


def test_empty_database_builds_complete_w3_schema(tmp_path: Path):
    engine = create_engine(tmp_path / "fresh.db")
    try:
        init_schema(engine)
        inspector = inspect(engine)
        assert {
            "users",
            "workspaces",
            "workspace_memberships",
            "workspace_invitations",
            "workspace_provider_configs",
            "script_edit_leases",
            "sessions",
            "schema_migrations",
        } <= set(
            inspector.get_table_names()
        )
        assert {
            "id", "username", "username_normalized", "email", "email_normalized",
            "display_name", "password_hash",
        } <= {c["name"] for c in inspector.get_columns("users")}
        assert {
            "id", "user_id", "refresh_token_hash", "rotation_counter", "expires_at",
            "created_at", "last_used_at", "revoked_at", "revoke_reason", "user_agent", "ip_address",
        } == {c["name"] for c in inspector.get_columns("sessions")}
        with engine.connect() as connection:
            assert connection.scalar(
                text("SELECT version FROM schema_migrations WHERE version = :version"),
                {"version": SCHEMA_VERSION},
            ) == SCHEMA_VERSION
    finally:
        engine.dispose()


def test_w1_empty_database_upgrades_to_w3(tmp_path: Path):
    engine = _make_w1_db(tmp_path / "w1.db")
    try:
        init_schema(engine)
        assert set(inspect(engine).get_table_names()) >= {"users", "workspaces", "sessions"}
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT COUNT(*) FROM users")) == 0
            assert connection.scalar(text("SELECT COUNT(*) FROM workspaces")) == 0
            assert connection.scalar(text("SELECT COUNT(*) FROM schema_migrations WHERE version='w3.1-auth'")) == 1
    finally:
        engine.dispose()


def test_w3_migration_is_idempotent(tmp_path: Path):
    engine = _make_w1_db(tmp_path / "w1-idempotent.db")
    try:
        init_schema(engine)
        init_schema(engine)
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT COUNT(*) FROM schema_migrations WHERE version='w3.1-auth'")) == 1
            assert connection.scalar(text("SELECT COUNT(*) FROM sqlite_master WHERE name='sessions'")) == 1
    finally:
        engine.dispose()


def test_w3_migration_failure_rolls_back_original_schema(tmp_path: Path, monkeypatch):
    engine = _make_w1_db(tmp_path / "w1-rollback.db")
    import src.storage.migrations.w3_auth as migration

    monkeypatch.setattr(migration, "W3_SESSIONS_DDL", "CREATE TABLE sessions (broken")
    try:
        with pytest.raises(Exception):
            migrate_w1_to_w3(engine)
        inspector = inspect(engine)
        assert "users_w3" not in inspector.get_table_names()
        assert "sessions" not in inspector.get_table_names()
        assert {c["name"] for c in inspector.get_columns("users")} == {
            "id", "email", "display_name", "password_hash", "created_at", "updated_at", "metadata_json"
        }
        with engine.connect() as connection:
            assert connection.scalar(text("PRAGMA foreign_keys")) == 1
    finally:
        engine.dispose()


def test_existing_w1_user_fails_fast_without_writes(tmp_path: Path):
    engine = _make_w1_db(tmp_path / "w1-user.db", with_user=True)
    try:
        with pytest.raises(MigrationError, match="contains data"):
            init_schema(engine)
        inspector = inspect(engine)
        assert "sessions" not in inspector.get_table_names()
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT COUNT(*) FROM users")) == 1
            assert connection.scalar(text("SELECT COUNT(*) FROM schema_migrations WHERE version='w3.1-auth'")) == 0
    finally:
        engine.dispose()
