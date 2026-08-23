"""SQLite engine, connection pragmas, schema initialization, and sessions."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine as sqlalchemy_create_engine, event, insert
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .schema import Base, SchemaMigration

DEFAULT_DB_PATH = Path("output") / "lumenx.db"
SCHEMA_VERSION = "w1.1"
INITIAL_SCHEMA_VERSION = SCHEMA_VERSION
SCHEMA_DESCRIPTION = "Initial LumenX W1.1 SQLite schema"
SCHEMA_CHECKSUM = hashlib.sha256(SCHEMA_DESCRIPTION.encode("utf-8")).hexdigest()


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


def init_schema(engine: Engine) -> None:
    """Create the W1 schema and record the idempotent initial schema version."""
    Base.metadata.create_all(engine)
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
    "create_engine",
    "init_schema",
    "create_session_factory",
    "get_session_factory",
    "session_factory",
]

