from tests.test_w2_project_api import api_client
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.apps.comic_gen import api as api_module
from src.apps.comic_gen.assets import AssetGenerator
from src.apps.comic_gen.models import AssetUnit, Character, ImageVariant, Prop, Scene


def _create_series(client, title="Cast flow"):
    response = client.post("/series", json={"title": title})
    assert response.status_code == 200, response.text
    return response.json()


def test_cast_ai_preview_is_side_effect_free_and_cancelable(api_client):
    series = _create_series(api_client)
    preview = api_client.post(
        f"/series/{series['id']}/assets/generate/preview",
        json={
            "asset_type": "character",
            "name": "侦探",
            "description": "戴帽子的侦探",
            "prompt": "cinematic detective reference sheet",
            "batch_size": 4,
            "model_name": "wan2.1-t2i",
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["status"] == "preview"
    assert body["estimated_calls"] == 4
    assert body["estimated_cost"] > 0
    assert api_client.get(f"/series/{series['id']}/assets").json()["characters"] == []

    canceled = api_client.post(
        f"/series/{series['id']}/assets/generate/previews/{body['preview_id']}/cancel"
    )
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"
    rejected = api_client.post(
        f"/series/{series['id']}/assets/generate/confirm",
        json={"preview_id": body["preview_id"]},
    )
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "CAST_PREVIEW_NOT_CONFIRMABLE"


def test_cast_ai_confirm_creates_asset_and_durable_job_item(api_client, monkeypatch):
    series = _create_series(api_client, "Cast confirm")
    preview = api_client.post(
        f"/series/{series['id']}/assets/generate/preview",
        json={
            "asset_type": "scene",
            "name": "夜港",
            "description": "雨夜港口",
            "prompt": "rainy harbor at night",
            "batch_size": 2,
        },
    ).json()
    started = []
    monkeypatch.setattr("src.apps.comic_gen.api._start_production_item", lambda item_id: started.append(item_id))

    confirmed = api_client.post(
        f"/series/{series['id']}/assets/generate/confirm",
        json={"preview_id": preview["preview_id"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()
    assert body["status"] == "confirmed"
    assert body["asset"]["name"] == "夜港"
    assert body["job_item"]["kind"] == "asset"
    assert body["job_item"]["payload"]["asset_type"] == "scene"
    assert started == [body["job_item"]["id"]]

    assets = api_client.get(f"/series/{series['id']}/assets").json()
    assert [item["name"] for item in assets["scenes"]] == ["夜港"]

    repeated = api_client.post(
        f"/series/{series['id']}/assets/generate/confirm",
        json={"preview_id": preview["preview_id"]},
    )
    assert repeated.status_code == 404


def test_cast_batch_lock_updates_only_requested_assets(api_client):
    series = _create_series(api_client, "Batch lock")
    for name in ("A", "B"):
        response = api_client.post(
            f"/series/{series['id']}/characters",
            json={"name": name, "description": "test"},
        )
        assert response.status_code == 200, response.text
    assets = api_client.get(f"/series/{series['id']}/assets").json()["characters"]
    response = api_client.post(
        f"/series/{series['id']}/assets/toggle_lock_batch",
        json={"asset_type": "character", "asset_ids": [assets[0]["id"]], "locked": True},
    )
    assert response.status_code == 200, response.text
    locked = {item["id"]: item["locked"] for item in response.json()["characters"]}
    assert locked[assets[0]["id"]] is True
    assert locked[assets[1]["id"]] is False


def test_generate_again_dispatches_a_new_task_after_provider_failure(api_client, monkeypatch):
    project = api_client.post("/projects?skip_analysis=true", json={"title": "Retry", "text": "A painter"}).json()
    pipeline = api_module.pipeline
    pipeline.scripts[project["id"]].characters.append(Character(id="painter", name="Painter", description="Old painter"))
    pipeline._save_data()
    calls = []

    def fail(*args, **kwargs):
        calls.append(args)
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(pipeline, "generate_asset", fail)
    results = []
    for _ in range(2):
        response = api_client.post(f"/projects/{project['id']}/assets/generate", json={
            "asset_id": "painter", "asset_type": "character", "prompt": "same prompt",
            "model_name": "qwen-image-2.0-pro",
        })
        assert response.status_code == 200, response.text
        body = response.json()
        assert pipeline.asset_generation_tasks[body["_task_id"]]["status"] == "failed"
        results.append(body)
    assert len(calls) == 2
    assert results[0]["_job_item_id"] != results[1]["_job_item_id"]


@pytest.mark.parametrize("kind,model,field", [("character", Character, "characters"), ("scene", Scene, "scenes"), ("prop", Prop, "props")])
def test_asset_generation_survives_refresh_and_preserves_concurrent_edits(api_client, monkeypatch, kind, model, field):
    project = api_client.post("/projects?skip_analysis=true", json={"title": "Asset refresh", "text": "A painter in the rain"}).json()
    pipeline = api_module.pipeline
    asset = model(id="asset-1", name="Painter", description="Original description")
    getattr(pipeline.scripts[project["id"]], field).append(asset)
    pipeline._save_data()
    captured = []

    def generate(prompt, output_path, **kwargs):
        captured.append(prompt)
        assert api_client.get(f"/projects/{project['id']}").status_code == 200
        current = getattr(pipeline.scripts[project["id"]], field)[0]
        current.description = "Edited while generating"
        variant = ImageVariant(id="concurrent", url="assets/concurrent.png")
        if kind == "character":
            current.reference_sheet = AssetUnit(image_variants=[variant], selected_image_id=variant.id)
        else:
            current.image_asset.variants.append(variant)
            current.image_asset.selected_id = variant.id
        current.image_url = variant.url
        pipeline._save_data()
        Path(output_path).write_bytes(b"generated-image")
        return output_path, 0

    pipeline.asset_generator = AssetGenerator()
    pipeline.asset_generator.model = SimpleNamespace(generate=generate)
    monkeypatch.setattr(pipeline.asset_generator, "_get_model_for", lambda _: pipeline.asset_generator.model)
    pipeline.generate_asset(project["id"], asset.id, kind, generation_type="reference_sheet", prompt="Keep the window on the right", apply_style=False)
    restored = api_client.get(f"/projects/{project['id']}").json()[field][0]
    unit = restored["reference_sheet"] if kind == "character" else restored["image_asset"]
    variants = unit["image_variants"] if kind == "character" else unit["variants"]
    assert len(variants) == 2
    assert restored["description"] == "Edited while generating"
    assert restored["image_url"] == "assets/concurrent.png"
    assert restored["status"] == "completed"
    assert captured == ["Keep the window on the right"]
