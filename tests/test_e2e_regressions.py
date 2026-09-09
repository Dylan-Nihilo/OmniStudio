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
