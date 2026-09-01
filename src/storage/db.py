"""SQLite engine, connection pragmas, schema initialization, and sessions."""

from __future__ import annotations

import hashlib
import time
from contextlib import contextmanager
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine as sqlalchemy_create_engine, event, insert
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .schema import Base, SchemaMigration

DEFAULT_DB_PATH = Path("output") / "omni_studio.db"
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


def _sqlite_database_url(db_path: str | Path) -> str:
    """Convert a filesystem path or SQLite URL into a SQLAlchemy URL."""
    value = str(db_path)
    if value.startswith("sqlite:"):
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
    """Create a synchronous SQLite engine for a parameterized database path.

    ``db_path`` may be a filesystem path, ``:memory:``, or an explicit SQLite
    SQLAlchemy URL.  Test callers can pass ``poolclass=StaticPool`` and
    ``connect_args={"check_same_thread": False}`` for a shared in-memory DB.
    """
    url = _sqlite_database_url(db_path)
    parsed_url = make_url(url)
    if parsed_url.get_backend_name() != "sqlite":
        raise ValueError(f"Storage database must use SQLite, got: {url}")

    connect_args = dict(engine_kwargs.pop("connect_args", {}) or {})
    if parsed_url.database in {None, ":memory:", ""}:
        connect_args.setdefault("check_same_thread", False)
        engine_kwargs.setdefault("poolclass", StaticPool)

    engine = sqlalchemy_create_engine(
        url,
        echo=echo,
        connect_args=connect_args,
        future=True,
        **engine_kwargs,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
        finally:
            cursor.close()

    return engine


@contextmanager
def begin_immediate(connection: Any) -> Iterator[Any]:
    """Run a short SQLite write transaction using ``BEGIN IMMEDIATE``."""
    connection.exec_driver_sql("BEGIN IMMEDIATE")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise


# Descriptive alias used by repository/migration callers.
sqlite_transaction = begin_immediate


def _record_schema_version(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            insert(SchemaMigration.__table__).prefix_with("OR IGNORE"),
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


def init_schema(engine: Engine) -> None:
    """Create a fresh W3 schema or apply registered ordered migrations."""
    from sqlalchemy import inspect

    tables = set(inspect(engine).get_table_names())
    if not tables:
        Base.metadata.create_all(engine)
        _record_schema_version(engine)
        return

    versions = _schema_version_rows(engine)
    if SCHEMA_VERSION in versions:
        # New feature tables are additive and safe to create for an existing
        # W3 database. Column/constraint changes still require a versioned
        # migration and are validated below.
        Base.metadata.create_all(engine)
        from .migrations.w3_auth import validate_w3_schema

        validate_w3_schema(engine)
        return

    registry = get_migration_registry()
    migration = registry.get(SCHEMA_VERSION)
    if migration is None:
        raise RuntimeError(f"No migration registered for schema version {SCHEMA_VERSION!r}")
    migration(engine)
    Base.metadata.create_all(engine)


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
