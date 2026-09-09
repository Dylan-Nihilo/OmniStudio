from tests.test_w2_project_api import api_client


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
