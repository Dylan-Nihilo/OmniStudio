from __future__ import annotations

from unittest.mock import patch

import src.apps.comic_gen.api as api_module
from src.apps.comic_gen.models import VideoTask
from src.storage.job_repository import JobRepository
from tests.test_w2_project_api import _create_project
from tests.test_w2_project_api import api_client


def _job_for_response(api_client, response):
    assert response.status_code == 200, response.text
    job_item_id = response.json().get("_job_item_id")
    assert job_item_id, response.text
    item = JobRepository(api_client.app.state.storage_engine).get_item(job_item_id)
    assert item is not None
    assert item.status == "succeeded", item
    return item


def test_generate_asset_returns_job_id_for_cancelable_cast_batch(api_client):
    project = _create_project(api_client, "Cancelable cast batch")
    route = f"/projects/{project['id']}"
    character = api_client.post(route + "/characters", json={"name": "阿岚"}).json()["characters"][0]
    response = api_client.post(
        route + "/assets/generate",
        json={
            "asset_id": character["id"],
            "asset_type": "character",
            "generation_type": "reference_sheet",
            "model_name": "wan2.7-image-pro",
            "prompt": "Night watch",
            "batch_size": 2,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    item = JobRepository(api_client.app.state.storage_engine).get_item(payload["_job_item_id"])
    assert item is not None
    assert payload["_job_id"] == item.job_id


def test_generate_storyboard_routes_through_unified_production_job(api_client):
    project = _create_project(api_client, "Storyboard job entrypoint")
    route = f"/projects/{project['id']}"
    frame = api_client.post(route + "/frames", json={"action_description": "A signal arrives"}).json()["frames"][0]
    script = api_module.pipeline.scripts[project["id"]]

    def generate(script_id):
        target = api_module.pipeline.scripts[script_id].frames[0]
        target.image_url = "storyboard/entrypoint.png"
        return api_module.pipeline.scripts[script_id]

    with patch.object(api_module.pipeline, "generate_storyboard", side_effect=generate):
        item = _job_for_response(api_client, api_client.post(route + "/generate_storyboard"))

    assert item.kind == "storyboard"
    assert item.payload["operation"] == "project_storyboard"
    assert item.media_refs[0]["uri"] == "storyboard/entrypoint.png"
    assert script.frames[0].id == frame["id"]


def test_generate_video_routes_through_unified_production_job(api_client):
    project = _create_project(api_client, "Video job entrypoint")
    route = f"/projects/{project['id']}"
    frame = api_client.post(route + "/frames", json={"action_description": "A signal arrives"}).json()["frames"][0]
    pipeline = api_module.pipeline

    def generate(script_id):
        script = pipeline.scripts[script_id]
        script.video_tasks = [
            VideoTask(
                id="entrypoint-take",
                project_id=script_id,
                frame_id=frame["id"],
                image_url="storyboard/entrypoint.png",
                prompt="A signal arrives",
                status="completed",
                video_url="video/entrypoint.mp4",
            )
        ]
        return script

    with patch.object(pipeline, "generate_video", side_effect=generate):
        item = _job_for_response(api_client, api_client.post(route + "/generate_video"))

    assert item.kind == "video"
    assert item.payload["operation"] == "project_video"
    assert item.media_refs[0]["uri"] == "video/entrypoint.mp4"


def test_dialogue_batch_routes_through_unified_production_job(api_client):
    project = _create_project(api_client, "Dialogue job entrypoint")
    route = f"/projects/{project['id']}"
    api_client.post(route + "/frames", json={"action_description": "A signal arrives"})
    pipeline = api_module.pipeline

    def generate(script_id, instructions=None):
        script = pipeline.scripts[script_id]
        script.frames[0].audio_url = "audio/entrypoint.wav"
        return script

    with patch.object(pipeline, "generate_dialogue_audio_batch", side_effect=generate):
        item = _job_for_response(api_client, api_client.post(route + "/dialogue_audio/batch", json={"instructions": {}}))

    assert item.kind == "audio"
    assert item.payload["operation"] == "dialogue_batch"
    assert item.media_refs[0]["uri"] == "audio/entrypoint.wav"


def test_dialogue_line_routes_through_unified_production_job(api_client):
    project = _create_project(api_client, "Dialogue line job entrypoint")
    route = f"/projects/{project['id']}"
    frame = api_client.post(route + "/frames", json={"action_description": "A signal arrives"}).json()["frames"][0]
    pipeline = api_module.pipeline

    def generate(script_id, frame_id, speed, pitch, volume, instructions=None):
        script = pipeline.scripts[script_id]
        assert frame_id == frame["id"]
        script.frames[0].audio_url = "audio/line-entrypoint.wav"
        return script

    with patch.object(pipeline, "generate_dialogue_line", side_effect=generate):
        item = _job_for_response(
            api_client,
            api_client.post(route + f"/frames/{frame['id']}/audio", json={"speed": 1.1, "pitch": 0.9, "volume": 70}),
        )

    assert item.kind == "audio"
    assert item.payload["operation"] == "dialogue_line"
    assert item.payload["frame_id"] == frame["id"]
    assert item.media_refs[0]["uri"] == "audio/line-entrypoint.wav"


def test_mix_sfx_routes_through_unified_production_job(api_client):
    project = _create_project(api_client, "SFX job entrypoint")
    route = f"/projects/{project['id']}"
    api_client.post(route + "/frames", json={"action_description": "A signal arrives"})
    pipeline = api_module.pipeline

    def generate(script_id):
        script = pipeline.scripts[script_id]
        script.frames[0].sfx_url = "audio/sfx-entrypoint.wav"
        return script

    with patch.object(pipeline, "generate_audio", side_effect=generate):
        item = _job_for_response(api_client, api_client.post(route + "/mix/generate_sfx"))

    assert item.kind == "audio"
    assert item.payload["operation"] == "mix_sfx"
    assert item.media_refs[0]["uri"] == "audio/sfx-entrypoint.wav"
