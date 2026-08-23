from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from src.apps.comic_gen.models import Script as ScriptPayload
from src.apps.comic_gen.models import Series as SeriesPayload
from src.storage.db import create_engine, init_schema
from src.storage.errors import LegacyDataError, MigrationError
from src.storage.migration import apply, preview
from src.storage.repository import SQLiteRepository
from src.storage.schema import MigrationRun, Project, Script, Series


def make_script(
    script_id: str = "script-1",
    *,
    title: str = "Episode 1",
    original_text: str = "A short script",
    series_id: str | None = None,
    episode_number: int | None = None,
    updated_at: float = 1_700_000_001.0,
) -> ScriptPayload:
    return ScriptPayload(
        id=script_id,
        title=title,
        original_text=original_text,
        series_id=series_id,
        episode_number=episode_number,
        created_at=1_700_000_000.0,
        updated_at=updated_at,
    )


def make_series(
    series_id: str = "series-1",
    *,
    episode_ids: list[str] | None = None,
) -> SeriesPayload:
    return SeriesPayload(
        id=series_id,
        title="A Series",
        description="Series description",
        episode_ids=episode_ids or [],
        created_at=1_700_000_000.0,
        updated_at=1_700_000_001.0,
    )


def write_payloads(path: Path, payloads: dict[str, ScriptPayload | SeriesPayload]) -> None:
    path.write_text(
        json.dumps(
            {key: value.model_dump(mode="json") for key, value in payloads.items()},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


@pytest.fixture
def legacy_paths(tmp_path: Path) -> tuple[Path, Path, Path]:
    projects_path = tmp_path / "projects.json"
    series_path = tmp_path / "series.json"
    db_path = tmp_path / "lumenx.db"
    script = make_script()
    write_payloads(projects_path, {script.id: script})
    return projects_path, series_path, db_path


def test_preview_valid_standalone_is_zero_write(legacy_paths):
    projects_path, series_path, db_path = legacy_paths

    report = preview(projects_path, series_path, db_path)

    assert report["status"] == "ok"
    assert report["ok"] is True
    assert report["counts"] == {
        "source_records": 1,
        "projects": 1,
        "episodes": 1,
        "scripts": 1,
        "series": 0,
        "synthetic_series": 0,
    }
    assert report["actions"] == {"insert": 3, "update": 0, "skip": 0}
    assert report["conflicts"] == []
    assert report["errors"] == []
    assert report["would_write"] is True
    assert not db_path.exists()
    assert not (db_path.parent / "backups").exists()


def test_preview_missing_projects_returns_empty_report(tmp_path: Path):
    report = preview(
        tmp_path / "missing-projects.json",
        tmp_path / "missing-series.json",
        tmp_path / "missing.db",
    )

    assert report["status"] == "ok"
    assert report["source_missing"] is True
    assert report["counts"]["scripts"] == 0
    assert report["would_write"] is False
    assert not (tmp_path / "missing.db").exists()


def test_preview_bad_json_raises_legacy_data_error(legacy_paths):
    projects_path, series_path, db_path = legacy_paths
    projects_path.write_text('{"script-1":', encoding="utf-8")

    with pytest.raises(LegacyDataError, match="Invalid legacy projects JSON syntax"):
        preview(projects_path, series_path, db_path)

    assert not db_path.exists()


def test_preview_key_id_mismatch_is_conflict(legacy_paths):
    projects_path, series_path, db_path = legacy_paths
    script = make_script("payload-id")
    write_payloads(projects_path, {"outer-key": script})

    report = preview(projects_path, series_path, db_path)

    assert report["status"] == "blocked"
    assert report["ok"] is False
    assert report["conflicts"] == [
        {
            "type": "key_id_mismatch",
            "kind": "projects",
            "key": "outer-key",
            "payload_id": "payload-id",
        }
    ]
    assert not db_path.exists()


def test_apply_succeeds_is_audited_and_same_source_is_idempotent(legacy_paths):
    projects_path, series_path, db_path = legacy_paths

    first = apply(projects_path, series_path, db_path)
    second = apply(projects_path, series_path, db_path)

    assert first["status"] == "completed"
    assert first["actions"] == {"insert": 3, "update": 0, "skip": 0}
    assert second["status"] == "skipped"
    assert second["would_write"] is False

    engine = create_engine(db_path)
    try:
        repository = SQLiteRepository(engine)
        loaded = repository.load_scripts()
        assert loaded["script-1"].original_text == "A short script"
        with engine.connect() as connection:
            run = connection.execute(
                select(
                    MigrationRun.status,
                    MigrationRun.rows_seen,
                    MigrationRun.rows_inserted,
                    MigrationRun.rows_updated,
                    MigrationRun.rows_skipped,
                    MigrationRun.source_sha256,
                )
            ).one()
        assert run.status == "completed"
        assert run.rows_seen == 1
        assert run.rows_inserted == 3
        assert run.rows_updated == 0
        assert run.rows_skipped == 0
        assert run.source_sha256 == first["source_sha256"]
    finally:
        engine.dispose()


def test_changed_source_requires_force_then_refreshes(legacy_paths):
    projects_path, series_path, db_path = legacy_paths
    apply(projects_path, series_path, db_path)
    changed = make_script(
        title="Updated title",
        original_text="Changed source text",
        updated_at=1_800_000_000.0,
    )
    write_payloads(projects_path, {changed.id: changed})

    with pytest.raises(MigrationError, match="refusing to overwrite"):
        apply(projects_path, series_path, db_path)

    forced = apply(projects_path, series_path, db_path, force=True)

    assert forced["status"] == "completed"
    assert any(item["kind"] == "database" for item in forced["backups"])
    engine = create_engine(db_path)
    try:
        assert SQLiteRepository(engine).load_scripts()[changed.id].title == "Updated title"
        with engine.connect() as connection:
            assert connection.scalar(
                select(func.count()).select_from(MigrationRun).where(
                    MigrationRun.status == "completed"
                )
            ) == 2
    finally:
        engine.dispose()


def test_apply_creates_verified_source_backup(legacy_paths):
    projects_path, series_path, db_path = legacy_paths
    source_hash = hashlib.sha256(projects_path.read_bytes()).hexdigest()

    report = apply(projects_path, series_path, db_path)

    project_backup = next(item for item in report["backups"] if item["kind"] == "projects")
    backup_path = Path(project_backup["backup_path"])
    assert backup_path.is_file()
    assert backup_path.parent.parent == tmp_path_backups(db_path)
    assert hashlib.sha256(backup_path.read_bytes()).hexdigest() == source_hash
    assert project_backup["sha256"] == source_hash
    assert project_backup["checksum_match"] is True
    assert projects_path.is_file()


def tmp_path_backups(db_path: Path) -> Path:
    return db_path.parent / "backups"


def test_series_binding_creates_series_project(tmp_path: Path):
    projects_path = tmp_path / "projects.json"
    series_path = tmp_path / "series.json"
    db_path = tmp_path / "lumenx.db"
    script = make_script(
        "episode-1",
        series_id="series-1",
        episode_number=1,
    )
    series = make_series(episode_ids=[script.id])
    write_payloads(projects_path, {script.id: script})
    write_payloads(series_path, {series.id: series})

    report = preview(projects_path, series_path, db_path)
    assert report["counts"]["projects"] == 1
    assert report["counts"]["series"] == 1
    assert report["counts"]["synthetic_series"] == 0
    assert report["conflicts"] == []

    apply(projects_path, series_path, db_path)
    engine = create_engine(db_path)
    try:
        with engine.connect() as connection:
            project = connection.execute(
                select(Project.id, Project.mode, Project.legacy_series_id)
            ).one()
            persisted_series = connection.execute(select(Series.id)).one()
        assert project == ("series-1", "series", "series-1")
        assert persisted_series == ("series-1",)
    finally:
        engine.dispose()


def test_missing_series_is_marked_and_synthesized(tmp_path: Path):
    projects_path = tmp_path / "projects.json"
    db_path = tmp_path / "lumenx.db"
    script = make_script(
        "episode-1",
        series_id="missing-series",
        episode_number=1,
    )
    write_payloads(projects_path, {script.id: script})

    report = preview(projects_path, tmp_path / "series.json", db_path)

    assert report["synthetic_series"] == ["missing-series"]
    assert report["counts"]["synthetic_series"] == 1
    assert report["counts"]["series"] == 1
    assert any(item["type"] == "synthetic_series" for item in report["warnings"])

    apply(projects_path, tmp_path / "series.json", db_path)
    engine = create_engine(db_path)
    try:
        recovered = SQLiteRepository(engine).load_series()["missing-series"]
        assert recovered.title == "[Recovered series missing-series]"
        assert recovered.episode_ids == ["episode-1"]
    finally:
        engine.dispose()


def test_bidirectional_series_mismatch_is_conflict(tmp_path: Path):
    projects_path = tmp_path / "projects.json"
    series_path = tmp_path / "series.json"
    script = make_script("episode-1", series_id="series-1", episode_number=1)
    series = make_series(episode_ids=[])
    write_payloads(projects_path, {script.id: script})
    write_payloads(series_path, {series.id: series})

    report = preview(projects_path, series_path, tmp_path / "lumenx.db")

    assert any(
        item["type"] == "script_missing_from_series_episodes"
        for item in report["conflicts"]
    )


def test_invalid_record_blocks_apply_without_partial_data(tmp_path: Path):
    projects_path = tmp_path / "projects.json"
    db_path = tmp_path / "lumenx.db"
    good = make_script("good-script")
    payload = {
        good.id: good.model_dump(mode="json"),
        "bad-script": {"id": "bad-script", "title": "Missing required fields"},
    }
    projects_path.write_text(json.dumps(payload), encoding="utf-8")
    engine = create_engine(db_path)
    init_schema(engine)
    engine.dispose()

    report = preview(projects_path, None, db_path)
    assert len(report["errors"]) == 1
    with pytest.raises(MigrationError, match="preflight blocked apply"):
        apply(projects_path, None, db_path)

    engine = create_engine(db_path)
    try:
        with engine.connect() as connection:
            assert connection.scalar(select(func.count()).select_from(Script)) == 0
            assert connection.scalar(select(func.count()).select_from(Project)) == 0
            assert connection.scalar(select(func.count()).select_from(MigrationRun)) == 0
    finally:
        engine.dispose()
