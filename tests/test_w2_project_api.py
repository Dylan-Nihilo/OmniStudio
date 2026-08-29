from __future__ import annotations

from unittest.mock import patch

import pytest

import src.apps.comic_gen.api as api_module
from src.apps.comic_gen.auth.service import AuthService
from src.apps.comic_gen.auth.settings import AuthSettings
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.storage.auth_repository import AuthRepository
from tests.auth_test_helpers import make_client


@pytest.fixture
def api_client(tmp_path, monkeypatch):
    """Run the real API against an isolated SQLite repository and auth service."""
    monkeypatch.chdir(tmp_path)
    with (
        patch("src.apps.comic_gen.pipeline.AssetGenerator"),
        patch("src.apps.comic_gen.pipeline.StoryboardGenerator"),
        patch("src.apps.comic_gen.pipeline.VideoGenerator"),
        patch("src.apps.comic_gen.pipeline.AudioGenerator"),
        patch("src.apps.comic_gen.pipeline.ExportManager"),
        patch.object(ComicGenPipeline, "_warmup_demucs_model", return_value=None),
    ):
        isolated_pipeline = ComicGenPipeline(
            config={
                "storage": {
                    "db_path": str(tmp_path / "lumenx.db"),
                    "legacy_projects_path": str(tmp_path / "projects.json"),
                    "legacy_series_path": str(tmp_path / "series.json"),
                    "auto_migrate": False,
                    "migration_mode": "off",
                }
            }
        )

    settings = AuthSettings(
        signing_secret="test-signing-secret-012345678901234567890123456789",
        access_ttl_seconds=900,
        refresh_ttl_seconds=7 * 86400,
        cookie_secure=False,
        allowed_origins=("http://testserver",),
        app_env="test",
    )
    service = AuthService(AuthRepository(isolated_pipeline.storage_engine), settings)

    previous_pipeline = api_module.pipeline
    previous_engine = api_module.app.state.storage_engine
    previous_service = api_module.app.state.auth_service
    previous_settings = api_module.app.state.auth_settings
    api_module.pipeline = isolated_pipeline
    api_module.app.state.storage_engine = isolated_pipeline.storage_engine
    api_module.app.state.auth_service = service
    api_module.app.state.auth_settings = settings

    try:
        with make_client(api_module.app, local=True) as client:
            setup = client.post(
                "/auth/setup",
                json={
                    "username": "owner",
                    "email": "owner@example.com",
                    "password": "correct horse battery staple",
                },
            )
            assert setup.status_code == 201, setup.text
            yield client
    finally:
        api_module.pipeline = previous_pipeline
        api_module.app.state.storage_engine = previous_engine
        api_module.app.state.auth_service = previous_service
        api_module.app.state.auth_settings = previous_settings
        isolated_pipeline.storage_engine.dispose()


def _create_project(client, title: str) -> dict:
    response = client.post(
        "/projects?skip_analysis=true",
        json={"title": title, "text": f"{title}正文"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _create_series(client, title: str = "系列项目") -> dict:
    response = client.post("/series", json={"title": title})
    assert response.status_code == 200, response.text
    return response.json()


def _add_episode(client, series_id: str, script_id: str, episode_number: int) -> None:
    response = client.post(
        f"/series/{series_id}/episodes",
        json={"script_id": script_id, "episode_number": episode_number},
    )
    assert response.status_code == 200, response.text


def test_get_project_episodes_returns_standalone_domain_view(api_client):
    script = _create_project(api_client, "独立短片")

    response = api_client.get(f"/projects/{script['id']}/episodes")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["id"] == script["id"]
    assert payload["title"] == "独立短片"
    assert payload["mode"] == "standalone"
    assert payload["episode_ids"] == [script["id"]]
    assert len(payload["episodes"]) == 1
    assert payload["episodes"][0]["id"] == script["id"]
    assert payload["episodes"][0]["project_id"] == script["id"]
    assert payload["episodes"][0]["script"]["id"] == script["id"]


def test_get_project_episodes_returns_sorted_series_and_shared_assets(api_client):
    series = _create_series(api_client)
    shared_character = api_client.post(
        f"/series/{series['id']}/characters",
        json={"name": "共享主角", "description": "系列共享角色"},
    )
    assert shared_character.status_code == 200, shared_character.text

    episode_two = _create_project(api_client, "第二集")
    episode_one = _create_project(api_client, "第一集")
    _add_episode(api_client, series["id"], episode_two["id"], 2)
    _add_episode(api_client, series["id"], episode_one["id"], 1)

    response = api_client.get(f"/projects/{series['id']}/episodes")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["id"] == series["id"]
    assert payload["mode"] == "series"
    assert [episode["episode_number"] for episode in payload["episodes"]] == [1, 2]
    assert [episode["id"] for episode in payload["episodes"]] == [
        episode_one["id"],
        episode_two["id"],
    ]
    assert all(episode["project_id"] == series["id"] for episode in payload["episodes"])
    assert payload["characters"][0]["id"] == shared_character.json()["id"]
    assert payload["characters"][0]["name"] == "共享主角"


def test_list_domain_projects_includes_standalone_and_series(api_client):
    standalone = _create_project(api_client, "独立项目")
    series = _create_series(api_client, "双集系列")
    episode_one = _create_project(api_client, "系列第一集")
    episode_two = _create_project(api_client, "系列第二集")
    _add_episode(api_client, series["id"], episode_one["id"], 1)
    _add_episode(api_client, series["id"], episode_two["id"], 2)

    response = api_client.get("/projects/domain")

    assert response.status_code == 200, response.text
    projects = {project["id"]: project for project in response.json()}
    assert projects[standalone["id"]]["mode"] == "standalone"
    assert projects[standalone["id"]]["episode_count"] == 1
    assert projects[standalone["id"]]["episode_ids"] == [standalone["id"]]
    assert projects[series["id"]]["mode"] == "series"
    assert projects[series["id"]]["episode_count"] == 2
    assert projects[series["id"]]["episode_ids"] == [episode_one["id"], episode_two["id"]]


def test_get_project_episodes_returns_404_for_unknown_project(api_client):
    response = api_client.get("/projects/nonexistent/episodes")

    assert response.status_code == 404
    assert response.json() == {"detail": "Project not found"}


def test_legacy_get_project_shape_and_source_merge_are_unchanged(api_client):
    series = _create_series(api_client)
    shared_character = api_client.post(
        f"/series/{series['id']}/characters",
        json={"name": "旧端点共享角色", "description": "用于兼容回归"},
    )
    assert shared_character.status_code == 200, shared_character.text
    episode = _create_project(api_client, "兼容集")
    _add_episode(api_client, series["id"], episode["id"], 1)

    response = api_client.get(f"/projects/{episode['id']}")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["id"] == episode["id"]
    assert payload["original_text"] == "兼容集正文"
    assert "script" not in payload
    shared = next(item for item in payload["characters"] if item["id"] == shared_character.json()["id"])
    assert shared["source"] == "series"
