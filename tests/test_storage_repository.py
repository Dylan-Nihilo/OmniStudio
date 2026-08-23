from __future__ import annotations

import hashlib
import json

import pytest
from sqlalchemy import select, update
from sqlalchemy.pool import StaticPool

from src.apps.comic_gen.models import Script as ScriptPayload
from src.apps.comic_gen.models import Series as SeriesPayload
from src.storage.db import create_engine, init_schema
from src.storage.errors import StorageError
from src.storage.repository import SQLiteRepository
from src.storage.schema import Episode, Project, Script, Series


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


@pytest.fixture
def repository(memory_engine):
    return SQLiteRepository(memory_engine)


def make_script(
    script_id: str = "script-1",
    *,
    title: str = "Episode 1",
    original_text: str = "A short script",
    series_id: str | None = None,
    episode_number: int | None = None,
) -> ScriptPayload:
    return ScriptPayload(
        id=script_id,
        title=title,
        original_text=original_text,
        series_id=series_id,
        episode_number=episode_number,
        created_at=1_700_000_000.0,
        updated_at=1_700_000_001.0,
    )


def make_series(series_id: str = "series-1") -> SeriesPayload:
    return SeriesPayload(
        id=series_id,
        title="A Series",
        description="Series description",
        created_at=1_700_000_000.0,
        updated_at=1_700_000_001.0,
    )


def test_script_round_trip(repository):
    script = make_script()

    repository.save_scripts({script.id: script})

    assert repository.load_scripts() == {script.id: script}


def test_save_script_fills_standalone_envelopes(repository, memory_engine):
    script = make_script()
    repository.save_scripts({script.id: script})

    with memory_engine.connect() as connection:
        project = connection.execute(
            select(Project.id, Project.mode).where(Project.id == script.id)
        ).one()
        episode = connection.execute(
            select(Episode.id, Episode.project_id, Episode.series_id).where(
                Episode.id == script.id
            )
        ).one()

    assert project == (script.id, "standalone")
    assert episode == (script.id, script.id, None)


def test_save_script_fills_series_project_and_recovered_series(repository, memory_engine, caplog):
    script = make_script("episode-1", series_id="series-missing", episode_number=1)

    with caplog.at_level("WARNING"):
        repository.save_scripts({script.id: script})

    with memory_engine.connect() as connection:
        project = connection.execute(
            select(Project.id, Project.mode, Project.legacy_series_id).where(
                Project.id == script.series_id
            )
        ).one()
        episode = connection.execute(
            select(Episode.project_id, Episode.series_id).where(Episode.id == script.id)
        ).one()
        recovered = connection.execute(
            select(Series.id, Series.project_id, Series.title).where(
                Series.id == script.series_id
            )
        ).one()

    assert project == (script.series_id, "series", script.series_id)
    assert episode == (script.series_id, script.series_id)
    assert recovered == (
        script.series_id,
        script.series_id,
        "[Recovered series series-missing]",
    )
    assert "missing Series" in caplog.text


def test_load_scripts_rejects_corrupt_payload(repository, memory_engine):
    script = make_script()
    repository.save_scripts({script.id: script})

    with memory_engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA ignore_check_constraints=ON")
        connection.execute(
            update(Script.__table__)
            .where(Script.id == script.id)
            .values(payload_json="not-json")
        )
        connection.exec_driver_sql("PRAGMA ignore_check_constraints=OFF")

    with pytest.raises(StorageError, match="Corrupt scripts payload"):
        repository.load_scripts()


def test_save_scripts_flushes_changed_payload(repository, memory_engine):
    script = make_script()
    repository.save_scripts({script.id: script})
    changed = script.model_copy(update={"title": "Updated title", "updated_at": 2_000_000_000.0})

    repository.save_scripts({changed.id: changed})

    loaded = repository.load_scripts()[script.id]
    assert loaded.title == "Updated title"
    with memory_engine.connect() as connection:
        row = connection.execute(
            select(Script.payload_json, Script.payload_sha256).where(Script.id == script.id)
        ).one()
    assert json.loads(row.payload_json)["title"] == "Updated title"
    expected_hash = hashlib.sha256(
        f"{script.id}{row.payload_json}".encode("utf-8")
    ).hexdigest()
    assert row.payload_sha256 == expected_hash


def test_save_scripts_rolls_back_when_a_later_upsert_fails(repository, memory_engine, monkeypatch):
    first = make_script("first")
    second = make_script("second")
    original = repository._upsert_script

    def fail_for_second(connection, script_id, payload, payload_json, payload_sha256):
        if script_id == "second":
            raise RuntimeError("injected failure")
        return original(connection, script_id, payload, payload_json, payload_sha256)

    monkeypatch.setattr(repository, "_upsert_script", fail_for_second)

    with pytest.raises(StorageError, match="transaction rolled back"):
        repository.save_scripts({first.id: first, second.id: second})

    with memory_engine.connect() as connection:
        assert connection.execute(select(Script.id)).all() == []
        assert connection.execute(select(Project.id)).all() == []
        assert connection.execute(select(Episode.id)).all() == []


def test_invalid_id_is_rejected_without_partial_write(repository, memory_engine):
    first = make_script("first")
    invalid = make_script("payload-id")

    with pytest.raises(StorageError, match="does not match payload id"):
        repository.save_scripts({first.id: first, "wrong-key": invalid})

    with memory_engine.connect() as connection:
        assert connection.execute(select(Script.id)).all() == []


def test_delete_script_cleans_standalone_envelope_but_not_series_project(repository, memory_engine):
    standalone = make_script("standalone")
    series = make_series()
    episode = make_script("episode-1", series_id=series.id, episode_number=1)
    repository.save_bundle({standalone.id: standalone, episode.id: episode}, {series.id: series})

    repository.delete_script(standalone.id)
    with memory_engine.connect() as connection:
        assert connection.execute(select(Project.id).where(Project.id == standalone.id)).first() is None
        assert connection.execute(select(Episode.id).where(Episode.id == standalone.id)).first() is None

    repository.delete_script(episode.id)
    with memory_engine.connect() as connection:
        assert connection.execute(select(Project.id).where(Project.id == series.id)).first() is not None
        assert connection.execute(select(Series.id).where(Series.id == series.id)).first() is not None


def test_delete_series_preserves_project_and_scripts_and_detaches_episodes(repository, memory_engine):
    series = make_series()
    episode = make_script("episode-1", series_id=series.id, episode_number=1)
    repository.save_bundle({episode.id: episode}, {series.id: series})

    repository.delete_series(series.id)

    assert repository.load_scripts()[episode.id] == episode
    with memory_engine.connect() as connection:
        assert connection.execute(select(Series.id).where(Series.id == series.id)).first() is None
        assert connection.execute(select(Project.id).where(Project.id == series.id)).first() is not None
        assert connection.execute(
            select(Episode.series_id).where(Episode.id == episode.id)
        ).scalar_one() is None



