"""Short API chains covering the desktop Web acceptance findings."""


import pytest


import io


import zipfile


import xml.etree.ElementTree as ET


from tests.test_w2_project_api import api_client, _create_project


from tests.test_w2_project_api import _create_series, _add_episode


import src.apps.comic_gen.api as api_module


from src.apps.comic_gen.models import VideoTask


from src.apps.comic_gen.models import AssetUnit, ImageVariant


from src.storage.job_repository import JobRepository


from pathlib import Path


@pytest.mark.parametrize("kind", ["characters", "scenes", "props"])
def test_manual_asset_creation_preserves_optional_fields_on_readback(api_client, kind):
    project = _create_project(api_client, "Empty cast")
    route = f"/projects/{project['id']}"
    data = {"name": "夜班素材", "image_url": "/files/output/uploads/reference.png"}
    if kind == "characters":
        data.update(persona="值班员", voice_id="longanyang")
    created = api_client.post(route + "/" + kind, json=data)
    assert created.status_code == 200, created.text
    asset = api_client.get(route).json()[kind][0]
    assert asset["name"] == data["name"]
    assert asset["description"] == ""
    if kind == "characters":
        assert asset["persona"] == data["persona"]
        assert asset["voice_id"] == data["voice_id"]
        assert asset["full_body_image_url"] == data["image_url"]
    else:
        assert asset["image_url"] == data["image_url"]


@pytest.mark.parametrize("operation", ["voice", "select_video", "rename"])
def test_project_writes_return_inherited_assets_without_copying_them_into_episode(api_client, operation):
    project = _create_project(api_client, "Shared cast")
    series = _create_series(api_client)
    _add_episode(api_client, series["id"], project["id"], 1)
    character = api_client.post(f"/series/{series['id']}/characters", json={"name": "阿岚"}).json()
    prop = api_client.post("/library/assets", json={"asset_type": "prop", "name": "未来来信"}).json()
    route = f"/projects/{project['id']}"
    frame = api_client.post(route + "/frames", json={"action_description": "Read the letter"}).json()["frames"][0]
    script = api_module.pipeline.scripts[project["id"]]
    script.video_tasks = [VideoTask(id="take", project_id=script.id, frame_id=frame["id"], image_url="", prompt="Read", status="completed", video_url="video/take.mp4")]
    api_module.pipeline._save_data()
    if operation == "voice":
        changed = api_client.post(route + f"/characters/{character['id']}/voice", json={"voice_id": "longanyang", "voice_name": "值班员"})
    elif operation == "select_video":
        changed = api_client.post(route + f"/frames/{frame['id']}/select_video", json={"video_id": "take"})
    else:
        changed = api_client.patch(route, json={"title": "Shared cast renamed"})
    assert changed.status_code == 200, changed.text
    fresh = api_client.get(route).json()
    for kind in ["characters", "scenes", "props"]:
        assert changed.json()[kind] == fresh[kind]
    assert fresh["characters"][0]["source"] == "series"
    assert fresh["props"][0]["source"] == "global"
    stored = api_module.pipeline.repository.load_scripts()[project["id"]]
    assert stored.characters == [] and stored.props == []


@pytest.mark.parametrize("operation", ["extract_preview", "reparse"])
def test_missing_llm_config_reports_service_failure_and_keeps_project(api_client, operation):
    assert api_client.post("/config/env", json={"DASHSCOPE_API_KEY": "", "LLM_API_KEY": ""}).status_code == 200
    project = _create_project(api_client, "Missing model config")
    route = f"/projects/{project['id']}"
    before = api_client.get(route).json()
    method = api_client.put if operation == "reparse" else api_client.post
    response = method(route + "/" + operation, json={"text": "夜班员打开信封。"})
    assert response.status_code == 503, response.text
    assert "API Key" in response.json()["detail"]
    assert api_client.get(route).json() == before
    assert method("/projects/missing/" + operation, json={"text": "正文"}).status_code == 404


def test_native_media_query_selects_workspace_and_still_enforces_membership(api_client):
    workspace = api_client.post("/auth/workspaces", json={"name": "Native media"}).json()["id"]
    uploaded = api_client.post("/upload", headers={"X-Workspace-ID": workspace}, files={"file": ("take.mp4", b"test-video-bytes", "video/mp4")})
    assert uploaded.status_code == 200, uploaded.text
    path = "/files/" + uploaded.json()["url"]
    assert api_client.get(path).status_code == 404
    native = api_client.get(path, params={"workspace_id": workspace}, headers={"Range": "bytes=0-3"})
    assert native.status_code == 206, native.text
    assert native.content == b"test"
    assert api_client.get(path, params={"workspace_id": "unknown-workspace"}).status_code == 404
    # Query scope is accepted only for media; business routes still use the header.
    assert api_client.get("/projects", params={"workspace_id": workspace}).status_code == 200
    api_client.post("/auth/logout")
    assert api_client.get(path, params={"workspace_id": workspace}).status_code == 401


@pytest.mark.parametrize("restart", [False, True])
def test_task_center_retry_executes_saved_asset_inputs_once_and_keeps_failure_history(api_client, restart):
    project = _create_project(api_client, "Retry cast")
    route = f"/projects/{project['id']}"
    character = api_client.post(route + "/characters", json={"name": "阿岚"}).json()["characters"][0]
    calls = []
    def provider(character, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise TimeoutError("Temporary provider failure")
        character.reference_sheet = AssetUnit(selected_image_id="ref", image_variants=[ImageVariant(id="ref", url="assets/characters/retry.png")])
    api_module.pipeline.asset_generator.generate_character.side_effect = provider
    started = api_client.post(route + "/assets/generate", json={"asset_id": character["id"], "asset_type": "character", "generation_type": "reference_sheet", "model_name": "wan2.7-image-pro", "prompt": "Night watch", "batch_size": 1})
    assert started.status_code == 200, started.text
    repository = JobRepository(api_module.pipeline.storage_engine)
    original = repository.get_item(started.json()["_job_item_id"])
    assert original.status == "failed"
    if restart:
        api_module.pipeline.asset_generation_tasks.clear()
    retry = api_client.post(f"/tasks/{original.job_id}/retry", json={"item_ids": [original.id], "idempotency_key": "recover-once"})
    assert retry.status_code == 200, retry.text
    job = api_client.get(f"/tasks/{original.job_id}").json()["job"]
    child = next(item for item in job["items"] if item["retry_of"] == original.id)
    assert child["status"] == "succeeded", child
    assert child["media_refs"][0]["uri"] == "assets/characters/retry.png"
    repeated = api_client.post(f"/tasks/{original.job_id}/retry", json={"item_ids": [original.id], "idempotency_key": "recover-once"})
    assert repeated.status_code == 200
    assert len(calls) == 2 and calls[0] == calls[1]
    assert repository.get_item(original.id).status == "failed"


def test_task_center_video_retry_creates_a_new_take_from_saved_inputs_and_adopts_it(api_client):
    project = _create_project(api_client, "Retry video")
    route = f"/projects/{project['id']}"
    frame = api_client.post(route + "/frames", json={"action_description": "Current edited prompt"}).json()["frames"][0]
    script = api_module.pipeline.scripts[project["id"]]
    script.video_tasks = [VideoTask(id="failed-take", project_id=script.id, frame_id=frame["id"], image_url="", prompt="Saved original prompt", status="failed", model="wan2.6-t2v", resolution="720p", duration=5)]
    api_module.pipeline._save_data()
    adapter = api_module._production_adapter()
    workspace = api_client.get("/auth/me").json()["workspace"]["id"]
    item = adapter.create("video", workspace, script.id, None, {"legacy_task_id": "failed-take"}, "failed-video")
    adapter.repository.transition_item(item.id, "processing")
    adapter.repository.transition_item(item.id, "failed", error={"code": "TIMEOUT", "message": "timeout"})
    calls = []
    def provider(**kwargs):
        calls.append(kwargs)
        Path(kwargs["output_path"]).write_bytes(b"video-fixture")
        return kwargs["output_path"], None
    api_module.pipeline.video_generator.model.generate.side_effect = provider
    for _ in range(2):
        response = api_client.post(f"/tasks/{item.job_id}/retry", json={"item_ids": [item.id], "idempotency_key": "retry-video-once"})
        assert response.status_code == 200, response.text
    saved = api_client.get(route).json()
    take = next(take for take in saved["video_tasks"] if take["retry_of_task_id"] == "failed-take")
    assert take["status"] == "completed", take
    assert saved["frames"][0]["selected_video_id"] == take["id"]
    assert len(calls) == 1
    assert calls[0]["prompt"] == "Saved original prompt"
    assert calls[0]["resolution"] == "720p"
    assert adapter.repository.get_item(item.id).status == "failed"
