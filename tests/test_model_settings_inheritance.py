from __future__ import annotations

import time
import uuid

from src.apps.comic_gen.models import ModelSettings, StoryboardFrame
from src.apps.comic_gen.models import Script, Series
from tests.test_cross_phase import pipeline
from tests.test_w2_project_api import api_client, _create_series


def test_model_settings_resolve_global_project_episode_and_shot_layers(pipeline):
    now = time.time()
    series = Series(id=str(uuid.uuid4()), title="继承系列", created_at=now, updated_at=now)
    episode = Script(id=str(uuid.uuid4()), title="继承集", original_text="正文", created_at=now, updated_at=now, series_id=series.id)
    pipeline.series_store[series.id] = series
    pipeline.scripts[episode.id] = episode
    frame = StoryboardFrame(id="shot-1", scene_id="scene-1")
    episode.frames = [frame]
    pipeline.scripts[episode.id] = episode

    pipeline.update_series(series.id, {"model_settings": ModelSettings(t2i_model="series-t2i")})
    pipeline.update_model_settings(episode.id, i2v_model="episode-i2v")
    pipeline.update_shot_model_settings(episode.id, frame.id, r2v_model="shot-r2v")

    resolved = pipeline.resolve_model_settings(episode.id, frame.id)

    assert resolved.settings.t2i_model == "series-t2i"
    assert resolved.settings.i2v_model == "episode-i2v"
    assert resolved.settings.r2v_model == "shot-r2v"
    assert resolved.sources["t2i_model"] == "project"
    assert resolved.sources["i2v_model"] == "episode"
    assert resolved.sources["r2v_model"] == "shot"


def test_model_settings_reset_episode_and_shot_reveal_parent_values(pipeline):
    now = time.time()
    series = Series(id=str(uuid.uuid4()), title="恢复系列", created_at=now, updated_at=now)
    episode = Script(id=str(uuid.uuid4()), title="恢复集", original_text="正文", created_at=now, updated_at=now, series_id=series.id)
    pipeline.series_store[series.id] = series
    pipeline.scripts[episode.id] = episode
    frame = StoryboardFrame(id="shot-1", scene_id="scene-1")
    episode.frames = [frame]
    pipeline.scripts[episode.id] = episode

    pipeline.update_series(series.id, {"model_settings": ModelSettings(i2v_model="series-i2v", r2v_model="series-r2v")})
    pipeline.update_model_settings(episode.id, i2v_model="episode-i2v")
    pipeline.update_shot_model_settings(episode.id, frame.id, r2v_model="shot-r2v")

    pipeline.update_model_settings(episode.id, reset_fields=["i2v_model"])
    pipeline.update_shot_model_settings(episode.id, frame.id, reset_fields=["r2v_model"])
    resolved = pipeline.resolve_model_settings(episode.id, frame.id)

    assert resolved.settings.i2v_model == "series-i2v"
    assert resolved.settings.r2v_model == "series-r2v"
    assert resolved.sources["i2v_model"] == "project"
    assert resolved.sources["r2v_model"] == "project"


def test_standalone_sparse_update_preserves_legacy_snapshot_and_supports_reset(pipeline):
    now = time.time()
    episode = Script(id=str(uuid.uuid4()), title="旧项目", original_text="正文", created_at=now, updated_at=now)
    episode.model_settings = ModelSettings(t2i_model="legacy-t2i", i2v_model="legacy-i2v")
    pipeline.scripts[episode.id] = episode

    pipeline.update_model_settings(episode.id, r2v_model="custom-r2v")
    resolved = pipeline.resolve_model_settings(episode.id)
    assert resolved.settings.t2i_model == "legacy-t2i"
    assert resolved.settings.i2v_model == "legacy-i2v"
    assert resolved.settings.r2v_model == "custom-r2v"

    pipeline.update_model_settings(episode.id, reset_fields=["i2v_model"])
    resolved = pipeline.resolve_model_settings(episode.id)
    assert resolved.settings.i2v_model == ModelSettings().i2v_model
    assert resolved.settings.t2i_model == "legacy-t2i"


def test_series_model_settings_reset_only_request_restores_default_and_validates_fields(api_client):
    series = _create_series(api_client, "Series model settings reset")
    updated = api_client.put(
        f"/series/{series['id']}/model_settings",
        json={"i2v_model": "custom-i2v"},
    )
    assert updated.status_code == 200, updated.text

    reset = api_client.put(
        f"/series/{series['id']}/model_settings",
        json={"reset_fields": ["i2v_model"]},
    )
    assert reset.status_code == 200, reset.text
    assert api_client.get(f"/series/{series['id']}/model_settings").json()["i2v_model"] != "custom-i2v"

    invalid = api_client.put(
        f"/series/{series['id']}/model_settings",
        json={"reset_fields": ["unknown_field"]},
    )
    assert invalid.status_code == 422


def test_effective_model_settings_api_reports_shot_override_sources(api_client):
    project = api_client.post(
        "/projects?skip_analysis=true",
        json={"title": "Effective model settings", "text": "正文"},
    ).json()
    frame = api_client.post(
        f"/projects/{project['id']}/frames",
        json={"action_description": "镜头"},
    ).json()["frames"][0]
    project_update = api_client.post(
        f"/projects/{project['id']}/model_settings",
        json={"i2v_model": "episode-i2v"},
    )
    assert project_update.status_code == 200, project_update.text
    shot_update = api_client.put(
        f"/projects/{project['id']}/frames/{frame['id']}/model_settings",
        json={"r2v_model": "shot-r2v"},
    )
    assert shot_update.status_code == 200, shot_update.text

    effective = api_client.get(
        f"/projects/{project['id']}/model_settings/effective?frame_id={frame['id']}"
    )
    assert effective.status_code == 200, effective.text
    payload = effective.json()
    assert payload["settings"]["i2v_model"] == "episode-i2v"
    assert payload["settings"]["r2v_model"] == "shot-r2v"
    assert payload["sources"]["i2v_model"] == "episode"
    assert payload["sources"]["r2v_model"] == "shot"
