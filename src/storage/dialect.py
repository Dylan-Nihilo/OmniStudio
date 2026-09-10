"""Small helpers that hide SQLite/MySQL syntax differences from repositories."""

from __future__ import annotations

from typing import Any

from sqlalchemy import insert
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.sql import Insert


def dialect_name(bind: Engine | Connection) -> str:
    return bind.dialect.name


def is_sqlite(bind: Engine | Connection) -> bool:
    return dialect_name(bind) == "sqlite"


def is_mysql(bind: Engine | Connection) -> bool:
    return dialect_name(bind) == "mysql"


def insert_ignore(table: Any) -> Insert:
    """``INSERT`` that silently skips rows violating a unique/primary key.

    SQLite spells it ``INSERT OR IGNORE``, MySQL ``INSERT IGNORE``; the prefixes are
    dialect-scoped so the same statement compiles correctly on both.
    """
    return insert(table).prefix_with("OR IGNORE", dialect="sqlite").prefix_with("IGNORE", dialect="mysql")


__all__ = ["dialect_name", "is_sqlite", "is_mysql", "insert_ignore"]
