from __future__ import annotations

import pytest
from sqlalchemy import delete, update
from sqlalchemy.pool import StaticPool

from src.apps.comic_gen.models import (
    Character,
    Project,
    ProjectMode,
    Script as ScriptPayload,
    Series as SeriesPayload,
)
from src.storage.db import create_engine, init_schema
from src.storage.errors import StorageError
from src.storage.repository import SQLiteRepository
from src.storage.schema import Script, Series


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
    series_id: str | None = None,
    episode_number: int | None = None,
    created_at: float = 1_700_000_000.0,
) -> ScriptPayload:
    return ScriptPayload(
        id=script_id,
        title=title,
        original_text=f"Story for {script_id}",
        series_id=series_id,
        episode_number=episode_number,
        created_at=created_at,
        updated_at=created_at + 1,
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
        characters=[Character(id="character-shared", name="Lin", description="Lead")],
        episode_ids=episode_ids or [],
        workflow_mode="r2v",
        content_mode="freeform",
        created_at=1_700_000_000.0,
        updated_at=1_700_000_001.0,
    )


def test_load_projects_returns_empty_mapping_for_empty_database(repository):
    assert repository.load_projects() == {}


def test_load_projects_builds_standalone_project_with_episode(repository):
    script = make_script()
    repository.save_scripts({script.id: script})

    projects = repository.load_projects()

    assert list(projects) == [script.id]
    project = projects[script.id]
    assert isinstance(project, Project)
    assert project.mode == ProjectMode.STANDALONE
    assert project.episode_ids == [script.id]
    assert len(project.episodes) == 1
    assert project.episodes[0].script.id == script.id
    assert project.episodes[0].project_id == script.id
    assert project.characters == []
    assert project.scenes == []
    assert project.props == []
    assert project.custom_voices == []
    assert project.art_direction is None


def test_load_projects_promotes_series_assets_and_orders_episodes(repository):
    series = make_series(episode_ids=["episode-2", "episode-1"])
    episode_2 = make_script(
        "episode-2",
        series_id=series.id,
        episode_number=2,
        created_at=1_700_000_020.0,
    )
    episode_1 = make_script(
        "episode-1",
        series_id=series.id,
        episode_number=1,
        created_at=1_700_000_010.0,
    )
    repository.save_bundle(
        {episode_2.id: episode_2, episode_1.id: episode_1},
        {series.id: series},
    )

    project = repository.load_projects()[series.id]

    assert project.mode == ProjectMode.SERIES
    assert [character.id for character in project.characters] == ["character-shared"]
    assert [episode.id for episode in project.episodes] == ["episode-1", "episode-2"]
    assert project.episode_ids == ["episode-1", "episode-2"]
    assert project.workflow_mode == series.workflow_mode
    assert project.content_mode == series.content_mode
    assert all(episode.project_id == series.id for episode in project.episodes)
    assert [episode.episode_number for episode in project.episodes] == [1, 2]
    assert all(episode.script.series_id is None for episode in project.episodes)
    assert all(episode.script.episode_number is None for episode in project.episodes)


def test_load_projects_handles_recovered_placeholder_series(repository):
    script = make_script(
        "episode-1",
        series_id="series-missing",
        episode_number=1,
    )
    repository.save_scripts({script.id: script})

    project = repository.load_projects()["series-missing"]

    assert project.mode == ProjectMode.SERIES
    assert project.characters == []
    assert project.episode_ids == [script.id]
    assert project.episodes[0].script.id == script.id


def test_load_projects_handles_series_project_without_series_row(
    repository,
    memory_engine,
    caplog,
):
    series = make_series()
    repository.save_series({series.id: series})
    with memory_engine.begin() as connection:
        connection.execute(delete(Series.__table__).where(Series.id == series.id))

    with caplog.at_level("WARNING"):
        project = repository.load_projects()[series.id]

    assert project.mode == ProjectMode.SERIES
    assert project.characters == []
    assert project.episodes == []
    assert "has no Series row" in caplog.text


def test_load_projects_rejects_corrupt_script_payload(repository, memory_engine):
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
        repository.load_projects()


def test_load_projects_is_idempotent_after_repeated_bundle_save(repository):
    series = make_series(episode_ids=["episode-1", "episode-2"])
    scripts = {
        "episode-1": make_script("episode-1", series_id=series.id, episode_number=1),
        "episode-2": make_script("episode-2", series_id=series.id, episode_number=2),
    }

    repository.save_bundle(scripts, {series.id: series})
    first = repository.load_projects()
    repository.save_bundle(scripts, {series.id: series})
    second = repository.load_projects()

    assert second == first
