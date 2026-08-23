from __future__ import annotations

import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool

from src.storage.db import SCHEMA_VERSION, create_engine, init_schema
from src.storage.schema import (
    Base,
    Episode,
    MigrationRun,
    Project,
    SchemaMigration,
    Script,
    Series,
    User,
    Workspace,
)


@pytest.fixture
def memory_engine():
    engine = create_engine(
        ":memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    init_schema(engine)
    try:
        yield engine
    finally:
        engine.dispose()


def test_schema_creates_all_tables_and_declared_indexes(memory_engine):
    inspector = inspect(memory_engine)

    assert set(inspector.get_table_names()) == {
        "schema_migrations",
        "migration_runs",
        "users",
        "workspaces",
        "projects",
        "episodes",
        "scripts",
        "series",
    }

    expected_indexes = {
        "migration_runs": {
            "uq_migration_runs_apply_source",
            "ix_migration_runs_source",
        },
        "workspaces": {"ix_workspaces_owner_user_id"},
        "projects": {
            "ix_projects_workspace_updated",
            "ix_projects_legacy_series_id",
            "ix_projects_mode",
        },
        "series": {"ix_series_updated"},
        "episodes": {
            "ix_episodes_project_order",
            "ix_episodes_series_order",
            "ix_episodes_updated",
        },
        "scripts": {"ix_scripts_updated", "ix_scripts_original_text_prefix"},
    }
    for table_name, expected in expected_indexes.items():
        actual = {index["name"] for index in inspector.get_indexes(table_name)}
        assert expected <= actual, table_name

    assert set(Base.metadata.tables) == {
        "schema_migrations",
        "migration_runs",
        "users",
        "workspaces",
        "projects",
        "episodes",
        "scripts",
        "series",
    }


def test_schema_migration_has_initial_version(memory_engine):
    with memory_engine.connect() as connection:
        row = connection.execute(
            select(
                SchemaMigration.version,
                SchemaMigration.checksum,
                SchemaMigration.description,
                SchemaMigration.applied_at,
            ).where(SchemaMigration.version == SCHEMA_VERSION)
        ).one()

    assert row.version == SCHEMA_VERSION
    assert row.checksum
    assert row.description
    assert row.applied_at > 0

    # init_schema is idempotent and must not create a second version row.
    init_schema(memory_engine)
    with memory_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(SchemaMigration)) == 1


def test_sqlite_pragmas_are_enabled_per_connection(memory_engine):
    with memory_engine.connect() as connection:
        assert connection.scalar(text("PRAGMA foreign_keys")) == 1
        assert connection.scalar(text("PRAGMA busy_timeout")) == 5000
        # SQLite reports "memory" for journal_mode on an in-memory database;
        # the file-backed create_engine path is covered separately below.
        assert connection.scalar(text("PRAGMA journal_mode")).lower() in {"memory", "wal"}


def test_foreign_keys_and_check_constraints_are_enforced(memory_engine):
    now = 1_700_000_000.0
    with pytest.raises(IntegrityError):
        with memory_engine.begin() as connection:
            connection.execute(
                Project.__table__.insert(),
                {
                    "id": "project-missing-workspace",
                    "workspace_id": "does-not-exist",
                    "title": "Broken",
                    "created_at": now,
                    "updated_at": now,
                },
            )

    with pytest.raises(IntegrityError):
        with memory_engine.begin() as connection:
            connection.execute(
                User.__table__.insert(),
                {
                    "id": "user-invalid-json",
                    "created_at": now,
                    "updated_at": now,
                    "metadata_json": "not-json",
                },
            )

    with pytest.raises(IntegrityError):
        with memory_engine.begin() as connection:
            connection.execute(
                MigrationRun.__table__.insert(),
                {
                    "id": "run-invalid-mode",
                    "migration_name": "test",
                    "source_name": "test",
                    "source_path": "test.json",
                    "source_sha256": "abc",
                    "mode": "invalid",
                    "status": "started",
                    "started_at": now,
                },
            )


def test_script_episode_fk_and_idempotent_envelope_constraints(memory_engine):
    now = 1_700_000_000.0
    with memory_engine.begin() as connection:
        connection.execute(
            Project.__table__.insert(),
            {
                "id": "project-1",
                "title": "Project",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            Episode.__table__.insert(),
            {
                "id": "episode-1",
                "project_id": "project-1",
                "title": "Episode",
                "created_at": now,
                "updated_at": now,
            },
        )

    with pytest.raises(IntegrityError):
        with memory_engine.begin() as connection:
            connection.execute(
                Script.__table__.insert(),
                {
                    "id": "script-with-missing-episode",
                    "episode_id": "missing-episode",
                    "payload_json": "{}",
                    "payload_sha256": "abc",
                    "created_at": now,
                    "updated_at": now,
                },
            )

    with memory_engine.begin() as connection:
        connection.execute(
            Script.__table__.insert(),
            {
                "id": "episode-1",
                "episode_id": "episode-1",
                "payload_json": "{}",
                "payload_sha256": "abc",
                "created_at": now,
                "updated_at": now,
            },
        )

    # scripts.id = episodes.id is represented by the application-level identity
    # convention plus the one-to-one FK; the schema still enforces one script per
    # episode and the FK itself.
    with pytest.raises(IntegrityError):
        with memory_engine.begin() as connection:
            connection.execute(
                Script.__table__.insert(),
                {
                    "id": "another-script",
                    "episode_id": "episode-1",
                    "payload_json": "{}",
                    "payload_sha256": "def",
                    "created_at": now,
                    "updated_at": now,
                },
            )


def test_series_project_delete_is_restricted(memory_engine):
    now = 1_700_000_000.0
    with memory_engine.begin() as connection:
        connection.execute(
            Project.__table__.insert(),
            {
                "id": "series-project",
                "title": "Series Project",
                "mode": "series",
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            Series.__table__.insert(),
            {
                "id": "series-1",
                "project_id": "series-project",
                "title": "Series",
                "payload_json": "{}",
                "payload_sha256": "abc",
                "created_at": now,
                "updated_at": now,
            },
        )

    with pytest.raises(IntegrityError):
        with memory_engine.begin() as connection:
            connection.execute(
                Project.__table__.delete().where(Project.id == "series-project")
            )


def test_file_database_path_is_parameterized_and_isolated(tmp_path):
    db_path = tmp_path / "nested" / "lumenx.db"
    engine = create_engine(db_path)
    try:
        init_schema(engine)
        assert db_path.is_file()
        with engine.connect() as connection:
            assert connection.scalar(text("PRAGMA journal_mode")).lower() == "wal"
    finally:
        engine.dispose()

    assert not (tmp_path / "output").exists()



