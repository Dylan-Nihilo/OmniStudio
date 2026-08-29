from __future__ import annotations

import time
from pathlib import Path

import pytest
from sqlalchemy import select

from src.apps.comic_gen.models import Script, Series
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.storage.errors import StorageError
from src.storage.schema import Episode, Project, Script as ScriptRow, Series as SeriesRow, Workspace


def _storage_config(db_path: Path, projects_path: Path, series_path: Path) -> dict:
    return {
        "storage": {
            "db_path": str(db_path),
            "legacy_projects_path": str(projects_path),
            "legacy_series_path": str(series_path),
            "auto_migrate": False,
        }
    }


def _script(script_id: str, title: str = "Episode") -> Script:
    now = time.time()
    return Script(
        id=script_id,
        title=title,
        original_text=f"{title} text",
        created_at=now,
        updated_at=now,
    )


def _series(series_id: str = "series-1", title: str = "Series") -> Series:
    now = time.time()
    return Series(id=series_id, title=title, created_at=now, updated_at=now)


@pytest.fixture
def pipeline(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(ComicGenPipeline, "_warmup_demucs_model", lambda self: None)
    instance = ComicGenPipeline(
        config=_storage_config(
            tmp_path / "lumenx.db",
            tmp_path / "projects.json",
            tmp_path / "series.json",
        )
    )
    try:
        yield instance
    finally:
        instance.storage_engine.dispose()


def test_add_episode_to_series_persists_complete_relationship(pipeline: ComicGenPipeline):
    series = _series()
    script = _script("episode-1")
    pipeline.series_store[series.id] = series
    pipeline.scripts[script.id] = script

    result = pipeline.add_episode_to_series(series.id, script.id, episode_number=3)

    assert result is series
    assert series.episode_ids == [script.id]
    assert script.series_id == series.id
    assert script.episode_number == 3
    assert pipeline.repository.load_scripts()[script.id].series_id == series.id
    assert pipeline.repository.load_series()[series.id].episode_ids == [script.id]
    with pipeline.storage_engine.connect() as connection:
        episode = connection.execute(
            select(Episode.project_id, Episode.series_id, Episode.episode_number).where(
                Episode.id == script.id
            )
        ).one()
    assert episode == (series.id, series.id, 3)


def test_repository_resolves_and_assigns_workspace_for_script_and_series(
    pipeline: ComicGenPipeline,
):
    workspace_id = "workspace-owner-1"
    with pipeline.storage_engine.begin() as connection:
        connection.execute(
            Workspace.__table__.insert().values(
                id=workspace_id,
                owner_user_id=None,
                name="Owner workspace",
                slug="default",
                created_at=time.time(),
                updated_at=time.time(),
                metadata_json="{}",
            )
        )

    series = _series("series-owned")
    script = _script("episode-owned")
    script.series_id = series.id
    pipeline.series_store[series.id] = series
    pipeline.scripts[script.id] = script
    pipeline.repository.save_bundle(pipeline.scripts, pipeline.series_store)

    assert pipeline.repository.project_exists(series.id)
    assert not pipeline.repository.project_exists("missing-project")
    assert pipeline.repository.workspace_for_project(series.id) is None
    assert pipeline.repository.workspace_for_script(script.id) is None
    assert pipeline.repository.workspace_for_series(series.id) is None
    assert pipeline.repository.assign_workspace_for_script(script.id, workspace_id)
    assert pipeline.repository.workspace_for_project(series.id) == workspace_id
    assert pipeline.repository.workspace_for_script(script.id) == workspace_id
    assert pipeline.repository.workspace_for_series(series.id) == workspace_id
    assert not pipeline.repository.assign_workspace_for_script(script.id, "other-workspace")


def test_add_episode_to_series_save_bundle_failure_leaves_database_unchanged(
    pipeline: ComicGenPipeline, monkeypatch
):
    series = _series()
    script = _script("episode-rollback")
    pipeline.series_store[series.id] = series
    pipeline.scripts[script.id] = script

    def fail_save_bundle(*args, **kwargs):
        raise StorageError("injected bundle failure")

    monkeypatch.setattr(pipeline.repository, "save_bundle", fail_save_bundle)

    with pytest.raises(StorageError, match="injected bundle failure"):
        pipeline.add_episode_to_series(series.id, script.id)

    with pipeline.storage_engine.connect() as connection:
        assert connection.execute(select(ScriptRow.id)).all() == []
        assert connection.execute(select(Episode.id)).all() == []
        assert connection.execute(select(SeriesRow.id)).all() == []
        assert connection.execute(select(Project.id)).all() == []


def test_delete_series_preserves_scripts_and_detaches_episode(pipeline: ComicGenPipeline):
    series = _series()
    episode = _script("episode-1")
    episode.series_id = series.id
    episode.episode_number = 1
    standalone = _script("standalone")
    series.episode_ids.append(episode.id)
    pipeline.series_store[series.id] = series
    pipeline.scripts = {episode.id: episode, standalone.id: standalone}
    pipeline.repository.save_bundle(pipeline.scripts, pipeline.series_store)

    pipeline.delete_series(series.id)

    assert series.id not in pipeline.series_store
    assert pipeline.scripts[episode.id].series_id is None
    assert pipeline.scripts[episode.id].episode_number is None
    with pipeline.storage_engine.connect() as connection:
        assert connection.execute(
            select(SeriesRow.id).where(SeriesRow.id == series.id)
        ).first() is None
        assert set(connection.execute(select(ScriptRow.id)).scalars()) == {
            episode.id,
            standalone.id,
        }
        assert connection.execute(
            select(Episode.series_id).where(Episode.id == episode.id)
        ).scalar_one() is None
        assert connection.execute(
            select(Episode.series_id).where(Episode.id == standalone.id)
        ).scalar_one() is None
        # R11 keeps the former Series project envelope as the durable container
        # for its surviving episode instead of cascading into Script deletion.
        assert connection.execute(
            select(Project.id).where(Project.id == series.id)
        ).scalar_one() == series.id


def test_create_series_from_import_persists_series_and_all_episodes(
    pipeline: ComicGenPipeline, monkeypatch
):
    counter = iter(("import-episode-1", "import-episode-2"))

    def create_draft(title: str, text: str) -> Script:
        return _script(next(counter), title=title).model_copy(update={"original_text": text})

    monkeypatch.setattr(pipeline.script_processor, "create_draft_script", create_draft)
    episodes_data = [
        {
            "episode_number": 1,
            "title": "First",
            "start_marker": "FIRST",
            "end_marker": "END-FIRST",
        },
        {
            "episode_number": 2,
            "title": "Second",
            "start_marker": "SECOND",
            "end_marker": "END-SECOND",
        },
    ]

    result = pipeline.create_series_from_import(
        "Imported Series",
        "FIRST body END-FIRST\nSECOND body END-SECOND",
        episodes_data,
    )

    series_id = result["series"]["id"]
    episode_ids = [episode["id"] for episode in result["episodes"]]
    loaded_series = pipeline.repository.load_series()[series_id]
    loaded_scripts = pipeline.repository.load_scripts()

    assert loaded_series.episode_ids == episode_ids
    assert set(loaded_scripts) == set(episode_ids)
    assert all(loaded_scripts[episode_id].series_id == series_id for episode_id in episode_ids)
    with pipeline.storage_engine.connect() as connection:
        rows = connection.execute(
            select(Episode.id, Episode.project_id, Episode.series_id, Episode.episode_number)
            .where(Episode.id.in_(episode_ids))
            .order_by(Episode.episode_number)
        ).all()
    assert rows == [
        (episode_ids[0], series_id, series_id, 1),
        (episode_ids[1], series_id, series_id, 2),
    ]
