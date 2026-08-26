"""W1.1 -> W3.1 authentication schema migration."""

from __future__ import annotations

import hashlib
import time
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from ..errors import MigrationError
from ..schema import Base, SchemaMigration
from ..db import SCHEMA_CHECKSUM, SCHEMA_DESCRIPTION, SCHEMA_VERSION, begin_immediate

W3_USERS_DDL = """
CREATE TABLE users_w3 (
    id                   TEXT PRIMARY KEY NOT NULL,
    username             TEXT NOT NULL,
    username_normalized  TEXT NOT NULL,
    email                TEXT NOT NULL,
    email_normalized     TEXT NOT NULL,
    display_name         TEXT,
    password_hash        TEXT NOT NULL,
    created_at           REAL NOT NULL,
    updated_at           REAL NOT NULL,
    metadata_json        TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT uq_users_username_normalized UNIQUE (username_normalized),
    CONSTRAINT uq_users_email_normalized UNIQUE (email_normalized),
    CONSTRAINT ck_users_username_length
        CHECK (length(username_normalized) BETWEEN 3 AND 64),
    CONSTRAINT ck_users_email_length
        CHECK (length(email_normalized) BETWEEN 3 AND 254),
    CONSTRAINT ck_users_metadata_json CHECK (json_valid(metadata_json))
)
"""

W3_SESSIONS_DDL = """
CREATE TABLE sessions (
    id                   TEXT PRIMARY KEY NOT NULL,
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash   TEXT NOT NULL,
    rotation_counter     INTEGER NOT NULL DEFAULT 0,
    expires_at           REAL NOT NULL,
    created_at           REAL NOT NULL,
    last_used_at         REAL,
    revoked_at           REAL,
    revoke_reason        TEXT,
    user_agent           TEXT,
    ip_address           TEXT,
    CONSTRAINT uq_sessions_refresh_token_hash UNIQUE (refresh_token_hash),
    CONSTRAINT ck_sessions_rotation_nonnegative CHECK (rotation_counter >= 0),
    CONSTRAINT ck_sessions_expiry_order CHECK (expires_at > created_at),
    CONSTRAINT ck_sessions_last_used_order
        CHECK (last_used_at IS NULL OR last_used_at >= created_at),
    CONSTRAINT ck_sessions_revoked_order
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
)
"""

W3_INDEX_DDL = (
    "CREATE INDEX IF NOT EXISTS ix_workspaces_owner_user_id ON workspaces(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS ix_sessions_user_revoked ON sessions(user_id, revoked_at)",
    "CREATE INDEX IF NOT EXISTS ix_sessions_expires_at ON sessions(expires_at)",
)


def _migration_checksum() -> str:
    payload = "\\n".join((W3_USERS_DDL, W3_SESSIONS_DDL, *W3_INDEX_DDL))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_w3_schema(engine: Engine) -> None:
    """Fail closed if a version marker exists but the schema is incomplete."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    required = {"users", "workspaces", "sessions", "schema_migrations"}
    missing = required - tables
    if missing:
        raise MigrationError(f"Schema {SCHEMA_VERSION} is incomplete; missing tables: {sorted(missing)}")

    expected_columns = {
        "users": {
            "id", "username", "username_normalized", "email", "email_normalized",
            "display_name", "password_hash", "created_at", "updated_at", "metadata_json",
        },
        "workspaces": {
            "id", "owner_user_id", "name", "slug", "created_at", "updated_at", "metadata_json",
        },
        "sessions": {
            "id", "user_id", "refresh_token_hash", "rotation_counter", "expires_at",
            "created_at", "last_used_at", "revoked_at", "revoke_reason", "user_agent", "ip_address",
        },
    }
    for table, expected in expected_columns.items():
        actual = {column["name"] for column in inspector.get_columns(table)}
        if not expected <= actual:
            raise MigrationError(
                f"Schema {SCHEMA_VERSION} table {table!r} is incomplete; "
                f"missing columns: {sorted(expected - actual)}"
            )

    workspace_indexes = {item["name"] for item in inspector.get_indexes("workspaces")}
    if "ix_workspaces_owner_user_id" not in workspace_indexes:
        raise MigrationError("Schema w3.1-auth is missing the workspace owner index")
    session_indexes = {item["name"] for item in inspector.get_indexes("sessions")}
    if not {"ix_sessions_user_revoked", "ix_sessions_expires_at"} <= session_indexes:
        raise MigrationError("Schema w3.1-auth is missing required session indexes")

    unique_columns = {
        table: {tuple(item["column_names"]) for item in inspector.get_unique_constraints(table)}
        for table in ("users", "workspaces", "sessions")
    }
    required_unique = {
        "users": {("username_normalized",), ("email_normalized",)},
        "workspaces": {("owner_user_id", "slug")},
        "sessions": {("refresh_token_hash",)},
    }
    for table, required_constraints in required_unique.items():
        if not required_constraints <= unique_columns[table]:
            raise MigrationError(
                f"Schema {SCHEMA_VERSION} table {table!r} is missing required unique constraints"
            )


def migrate_w1_to_w3(engine: Engine) -> None:
    """Rebuild the empty W1 users table and add the W3 session table atomically.

    W1 users contain no recoverable authentication identity.  A non-empty users
    table therefore fails closed rather than inventing usernames/passwords.
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if SCHEMA_VERSION in _schema_versions(engine):
        validate_w3_schema(engine)
        return
    if not tables:
        Base.metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(
                SchemaMigration.__table__.insert().values(
                    version=SCHEMA_VERSION,
                    applied_at=time.time(),
                    checksum=SCHEMA_CHECKSUM,
                    description=SCHEMA_DESCRIPTION,
                )
            )
        return
    if "users" not in tables:
        raise MigrationError("Cannot migrate to W3.1: existing database has no users table")

    with engine.connect() as connection:
        user_count = int(connection.scalar(text("SELECT COUNT(*) FROM users")) or 0)
        connection.rollback()
        if user_count:
            raise MigrationError(
                "Refusing W1.1 -> W3.1 migration because users table contains data; "
                "automatic authentication identity fabrication is forbidden"
            )

        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        try:
            with begin_immediate(connection):
                connection.exec_driver_sql(W3_USERS_DDL)
                connection.exec_driver_sql("DROP TABLE users")
                connection.exec_driver_sql("ALTER TABLE users_w3 RENAME TO users")
                connection.exec_driver_sql(W3_SESSIONS_DDL)
                for statement in W3_INDEX_DDL:
                    connection.exec_driver_sql(statement)

                if "schema_migrations" not in tables:
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
                foreign_key_errors = connection.exec_driver_sql(
                    "PRAGMA foreign_key_check"
                ).fetchall()
                if foreign_key_errors:
                    raise MigrationError(
                        f"foreign_key_check failed during W3.1 migration: {foreign_key_errors!r}"
                    )
                connection.exec_driver_sql(
                    """
                    INSERT INTO schema_migrations(version, applied_at, checksum, description)
                    VALUES (?, ?, ?, ?)
                    """,
                    (SCHEMA_VERSION, time.time(), SCHEMA_CHECKSUM, SCHEMA_DESCRIPTION),
                )
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")

    validate_w3_schema(engine)


def _schema_versions(engine: Engine) -> set[str]:
    if "schema_migrations" not in inspect(engine).get_table_names():
        return set()
    with engine.connect() as connection:
        return set(connection.execute(text("SELECT version FROM schema_migrations")).scalars())


__all__ = ["migrate_w1_to_w3", "validate_w3_schema"]
