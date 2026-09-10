"""Storage engine (SQLite or MySQL), connection setup, schema initialization, and sessions."""

from __future__ import annotations

import hashlib
import os
import time
from contextlib import contextmanager
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine as sqlalchemy_create_engine, event, select
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .dialect import insert_ignore, is_sqlite
from .schema import Base, SchemaMigration, Workspace, WorkspaceMembership

DATABASE_URL_ENV = "OMNI_STUDIO_DATABASE_URL"
SUPPORTED_DIALECTS = {"sqlite", "mysql"}


def resolve_default_db_path(output_dir: Path = Path("output")) -> Path:
    preferred_path = output_dir / "omni_studio.db"
    legacy_path = output_dir / "lumenx.db"
    # ponytail: Keep the legacy filename in place; use a versioned migration if
    # the physical database file ever needs to be renamed.
    return legacy_path if legacy_path.exists() and not preferred_path.exists() else preferred_path


DEFAULT_DB_PATH = resolve_default_db_path()


def resolve_database_url(db_path: str | Path | None = None) -> str:
    """Pick the storage URL: explicit argument, then ``OMNI_STUDIO_DATABASE_URL``, then the SQLite file.

    Desktop and local installs never set the environment variable and keep using the
    SQLite file under ``output/``; hosted deployments point it at MySQL.
    """
    if db_path is not None and str(db_path) not in {str(DEFAULT_DB_PATH), ""}:
        return _database_url(db_path)
    configured = os.environ.get(DATABASE_URL_ENV, "").strip()
    if configured:
        return configured
    return _database_url(db_path if db_path is not None else DEFAULT_DB_PATH)
INITIAL_SCHEMA_VERSION = "w1.1"
SCHEMA_VERSION = "w3.1-auth"
SCHEMA_DESCRIPTION = "Omni Studio W3.1 authentication schema"
SCHEMA_CHECKSUM = hashlib.sha256(SCHEMA_DESCRIPTION.encode("utf-8")).hexdigest()

# Populated lazily to avoid an import cycle between the migration module and the
# SQLite transaction helpers in this module.
MIGRATION_REGISTRY: dict[str, Callable[[Engine], None]] = {}


def get_migration_registry() -> dict[str, Callable[[Engine], None]]:
    if not MIGRATION_REGISTRY:
        from .migrations.w3_auth import migrate_w1_to_w3

        MIGRATION_REGISTRY[SCHEMA_VERSION] = migrate_w1_to_w3
    return MIGRATION_REGISTRY


def _database_url(db_path: str | Path) -> str:
    """Convert a filesystem path or SQLAlchemy URL into a SQLAlchemy URL."""
    value = str(db_path)
    if "://" in value or value.startswith("sqlite:"):
        return value
    if value == ":memory:":
        return "sqlite:///:memory:"
    path = Path(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path.absolute().as_posix()}"


def create_engine(
    db_path: str | Path = DEFAULT_DB_PATH,
    *,
    echo: bool = False,
    **engine_kwargs: Any,
) -> Engine:
    """Create a synchronous engine for a SQLite path/URL or a MySQL URL.

    ``db_path`` may be a filesystem path, ``:memory:``, or an explicit SQLAlchemy URL.
    When it is the default SQLite path, ``OMNI_STUDIO_DATABASE_URL`` (if set) wins so a
    hosted deployment can switch storage without code changes. Test callers can pass
    ``poolclass=StaticPool`` and ``connect_args={"check_same_thread": False}`` for a
    shared in-memory SQLite DB.
    """
    url = resolve_database_url(db_path)
    parsed_url = make_url(url)
    backend = parsed_url.get_backend_name()
    if backend not in SUPPORTED_DIALECTS:
        raise ValueError(f"Storage database must use one of {sorted(SUPPORTED_DIALECTS)}, got: {backend}")

    connect_args = dict(engine_kwargs.pop("connect_args", {}) or {})
    if backend == "sqlite":
        if parsed_url.database in {None, ":memory:", ""}:
            connect_args.setdefault("check_same_thread", False)
            engine_kwargs.setdefault("poolclass", StaticPool)
    else:
        connect_args.setdefault("charset", "utf8mb4")
        engine_kwargs.setdefault("pool_pre_ping", True)
        engine_kwargs.setdefault("pool_recycle", 1800)
        engine_kwargs.setdefault("pool_size", 10)
        engine_kwargs.setdefault("max_overflow", 20)

    engine = sqlalchemy_create_engine(
        url,
        echo=echo,
        connect_args=connect_args,
        future=True,
        **engine_kwargs,
    )

    if backend == "sqlite":

        @event.listens_for(engine, "connect")
        def _set_sqlite_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA busy_timeout=5000")
            finally:
                cursor.close()

    else:

        @event.listens_for(engine, "connect")
        def _set_mysql_session(dbapi_connection: Any, _connection_record: Any) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'")
                cursor.execute("SET SESSION time_zone='+00:00'")
                cursor.execute("SET SESSION innodb_lock_wait_timeout=10")
            finally:
                cursor.close()

    return engine


@contextmanager
def begin_immediate(connection: Any) -> Iterator[Any]:
    """Run a short write transaction.

    SQLite takes the reserved lock up front with ``BEGIN IMMEDIATE`` so concurrent
    writers queue instead of failing late. MySQL/InnoDB uses row locks; a plain
    transaction is enough, and read-modify-write paths add ``SELECT ... FOR UPDATE``.
    """
    if is_sqlite(connection):
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        return
    with connection.begin():
        yield connection


# Descriptive alias used by repository/migration callers.
sqlite_transaction = begin_immediate


def _record_schema_version(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            insert_ignore(SchemaMigration.__table__),
            {
                "version": SCHEMA_VERSION,
                "applied_at": time.time(),
                "checksum": SCHEMA_CHECKSUM,
                "description": SCHEMA_DESCRIPTION,
            },
        )


def _schema_version_rows(engine: Engine) -> set[str]:
    from sqlalchemy import inspect

    if "schema_migrations" not in inspect(engine).get_table_names():
        return set()
    with engine.connect() as connection:
        return set(connection.execute(SchemaMigration.__table__.select()).scalars().all())


def _backfill_owner_memberships(engine: Engine) -> None:
    """Idempotently mirror legacy ``owner_user_id`` rows into memberships."""
    with engine.begin() as connection:
        owners = connection.execute(
            select(Workspace.id, Workspace.owner_user_id, Workspace.created_at).where(
                Workspace.owner_user_id.is_not(None)
            )
        ).all()
        for workspace_id, user_id, joined_at in owners:
            connection.execute(
                insert_ignore(WorkspaceMembership.__table__),
                {
                    "workspace_id": workspace_id,
                    "user_id": user_id,
                    "role": "owner",
                    "access_role": "owner",
                    "invited_by_user_id": None,
                    "joined_at": joined_at,
                },
            )


def _ensure_access_role_columns(engine: Engine) -> None:
    """Add role-label columns without rebuilding legacy tables."""
    from sqlalchemy import inspect

    inspector = inspect(engine)
    column_type = "TEXT" if is_sqlite(engine) else "VARCHAR(64)"
    additions = {
        "workspace_memberships": f"access_role {column_type} NOT NULL DEFAULT 'member'",
        "workspace_invitations": f"access_role {column_type} NOT NULL DEFAULT 'member'",
    }
    with engine.begin() as connection:
        for table, definition in additions.items():
            columns = {column["name"] for column in inspector.get_columns(table)}
            if "access_role" not in columns:
                connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {definition}")
            if table == "workspace_memberships":
                connection.exec_driver_sql(
                    "UPDATE workspace_memberships SET access_role = 'owner' WHERE role = 'owner'"
                )


def init_schema(engine: Engine) -> None:
    """Create a fresh W3 schema or apply registered ordered migrations."""
    from sqlalchemy import inspect

    tables = set(inspect(engine).get_table_names())
    if not tables:
        Base.metadata.create_all(engine)
        _ensure_access_role_columns(engine)
        _record_schema_version(engine)
        _backfill_owner_memberships(engine)
        return

    versions = _schema_version_rows(engine)
    if SCHEMA_VERSION in versions:
        # New feature tables are additive and safe to create for an existing
        # W3 database. Column/constraint changes still require a versioned
        # migration and are validated below.
        Base.metadata.create_all(engine)
        _ensure_access_role_columns(engine)
        _backfill_owner_memberships(engine)
        from .migrations.w3_auth import validate_w3_schema

        validate_w3_schema(engine)
        return

    registry = get_migration_registry()
    migration = registry.get(SCHEMA_VERSION)
    if migration is None:
        raise RuntimeError(f"No migration registered for schema version {SCHEMA_VERSION!r}")
    migration(engine)
    Base.metadata.create_all(engine)
    _ensure_access_role_columns(engine)
    _backfill_owner_memberships(engine)


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    """Return a short-lived, non-expiring synchronous Session factory."""
    return sessionmaker(
        bind=engine,
        class_=Session,
        autoflush=False,
        expire_on_commit=False,
    )


# Descriptive aliases for callers that use either naming convention.
get_session_factory = create_session_factory
session_factory = create_session_factory


__all__ = [
    "DEFAULT_DB_PATH",
    "DATABASE_URL_ENV",
    "resolve_default_db_path",
    "resolve_database_url",
    "SCHEMA_VERSION",
    "INITIAL_SCHEMA_VERSION",
    "SCHEMA_DESCRIPTION",
    "SCHEMA_CHECKSUM",
    "MIGRATION_REGISTRY",
    "get_migration_registry",
    "begin_immediate",
    "sqlite_transaction",
    "create_engine",
    "init_schema",
    "create_session_factory",
    "get_session_factory",
    "session_factory",
]
