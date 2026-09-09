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
