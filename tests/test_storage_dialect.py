"""Engine resolution and dialect helpers must keep SQLite behaviour and accept MySQL URLs."""

from __future__ import annotations

import os

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.dialects import mysql, sqlite
from sqlalchemy.schema import CreateTable

from src.storage.db import DATABASE_URL_ENV, DEFAULT_DB_PATH, begin_immediate, create_engine, init_schema, resolve_database_url
from src.storage.dialect import insert_ignore, is_mysql, is_sqlite
from src.storage.schema import Base, SchemaMigration, WorkspaceMembership


def test_default_path_stays_sqlite(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(DATABASE_URL_ENV, raising=False)
    assert resolve_database_url().startswith("sqlite:///")
    assert resolve_database_url(":memory:") == "sqlite:///:memory:"


def test_env_url_overrides_default_path_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DATABASE_URL_ENV, "mysql+pymysql://u:p@db:3306/omnistudio?charset=utf8mb4")
    assert resolve_database_url().startswith("mysql+pymysql://")
    assert resolve_database_url(str(DEFAULT_DB_PATH)).startswith("mysql+pymysql://")
    # Explicit non-default paths (tests, desktop overrides) are never redirected.
    assert resolve_database_url(":memory:") == "sqlite:///:memory:"
    assert resolve_database_url("sqlite:///tmp/other.db") == "sqlite:///tmp/other.db"


def test_create_engine_rejects_unknown_dialect(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(DATABASE_URL_ENV, raising=False)
    with pytest.raises(ValueError, match="must use one of"):
        create_engine("postgresql://u:p@localhost/x")


def test_mysql_engine_constructs_without_connecting(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("pymysql")
    engine = create_engine("mysql+pymysql://u:p@127.0.0.1:1/x")
    assert is_mysql(engine) and not is_sqlite(engine)
    assert engine.pool._pre_ping is True


def test_sqlite_engine_keeps_pragmas_and_partial_owner_index() -> None:
    engine = create_engine(":memory:")
    init_schema(engine)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar() in {"wal", "memory"}
    names = {index["name"] for index in inspect(engine).get_indexes("workspace_memberships")}
    assert "uq_workspace_memberships_owner" in names


def test_insert_ignore_compiles_per_dialect() -> None:
    statement = insert_ignore(SchemaMigration.__table__)
    assert str(statement.compile(dialect=sqlite.dialect())).startswith("INSERT OR IGNORE INTO schema_migrations")
    assert str(statement.compile(dialect=mysql.dialect())).startswith("INSERT IGNORE INTO schema_migrations")


def test_insert_ignore_skips_duplicates_on_sqlite() -> None:
    engine = create_engine(":memory:")
    init_schema(engine)
    with engine.connect() as connection:
        with begin_immediate(connection):
            connection.execute(insert_ignore(SchemaMigration.__table__),
                               {"version": "w3.1-auth", "applied_at": 1.0, "checksum": "x", "description": "dup"})
        rows = connection.execute(select(SchemaMigration.version)).scalars().all()
    assert rows.count("w3.1-auth") == 1


def test_every_table_has_mysql_ddl_without_text_keys() -> None:
    for table in Base.metadata.tables.values():
        ddl = str(CreateTable(table).compile(dialect=mysql.dialect()))
        assert "CREATE TABLE" in ddl
        keyed = {c.name for c in table.primary_key.columns} | {fk.parent.name for fk in table.foreign_keys}
        for index in table.indexes:
            keyed |= {c.name for c in index.columns}
        for constraint in table.constraints:
            if constraint.__class__.__name__ == "UniqueConstraint":
                keyed |= {c.name for c in constraint.columns}
        for name in keyed:
            column_type = str(table.c[name].type.compile(dialect=mysql.dialect()))
            assert column_type != "TEXT", f"{table.name}.{name} is a keyed TEXT column"


def test_membership_owner_uniqueness_is_dialect_specific() -> None:
    # No sqlite_where index remains in metadata; both dialects get it from DDL listeners.
    assert all(index.name != "uq_workspace_memberships_owner" for index in WorkspaceMembership.__table__.indexes)


@pytest.mark.skipif(not os.environ.get("OMNI_STUDIO_TEST_MYSQL_URL"), reason="needs a MySQL test database")
def test_mysql_schema_round_trip() -> None:
    engine = create_engine(os.environ["OMNI_STUDIO_TEST_MYSQL_URL"])
    with engine.begin() as connection:
        connection.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for name in inspect(engine).get_table_names():
            connection.execute(text(f"DROP TABLE `{name}`"))
    init_schema(engine)
    init_schema(engine)  # idempotent on an existing schema
    inspector = inspect(engine)
    assert len(inspector.get_table_names()) == len(Base.metadata.tables)
    owner_index = [i for i in inspector.get_indexes("workspace_memberships") if i["name"] == "uq_workspace_memberships_owner"]
    assert owner_index and owner_index[0]["unique"] and owner_index[0]["column_names"] == ["owner_workspace_id"]
