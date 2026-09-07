from __future__ import annotations

import hashlib
from unittest.mock import patch

import pytest
import src.apps.comic_gen.api as api_module
from src.apps.comic_gen.auth.service import AuthService
from src.apps.comic_gen.auth.settings import AuthSettings
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.storage.auth_repository import AuthRepository
from src.storage.source_repository import SourceRepository
from tests.auth_test_helpers import make_client


@pytest.fixture
def source_client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    with (
        patch("src.apps.comic_gen.pipeline.AssetGenerator"),
        patch("src.apps.comic_gen.pipeline.StoryboardGenerator"),
        patch("src.apps.comic_gen.pipeline.VideoGenerator"),
        patch("src.apps.comic_gen.pipeline.AudioGenerator"),
        patch("src.apps.comic_gen.pipeline.ExportManager"),
        patch.object(ComicGenPipeline, "_warmup_demucs_model", return_value=None),
    ):
        pipeline = ComicGenPipeline(
            config={
                "storage": {
                    "db_path": str(tmp_path / "omni_studio.db"),
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
        allowed_origins=("http://testserver",),
        app_env="test",
    )
    service = AuthService(AuthRepository(pipeline.storage_engine), settings)
    previous = (
        api_module.pipeline,
        api_module.MEDIA_PROJECT_ROOT,
        api_module.app.state.storage_engine,
        api_module.app.state.auth_service,
        api_module.app.state.auth_settings,
        getattr(api_module.app.state, "source_repository", None),
    )
    api_module.pipeline = pipeline
    api_module.MEDIA_PROJECT_ROOT = tmp_path.resolve()
    api_module.app.state.storage_engine = pipeline.storage_engine
    api_module.app.state.auth_service = service
    api_module.app.state.auth_settings = settings
    api_module.app.state.source_repository = SourceRepository(pipeline.storage_engine)
    try:
        with make_client(api_module.app, local=True) as client:
            setup = client.post(
                "/auth/setup",
                json={"username": "owner", "email": "owner@example.com", "password": "correct horse battery staple"},
            )
            assert setup.status_code == 201, setup.text
            yield client, pipeline
    finally:
        (
            api_module.pipeline,
            api_module.MEDIA_PROJECT_ROOT,
            api_module.app.state.storage_engine,
            api_module.app.state.auth_service,
            api_module.app.state.auth_settings,
            old_source_repository,
        ) = previous
        api_module.app.state.source_repository = old_source_repository
        pipeline.storage_engine.dispose()


def test_source_document_chapter_revision_and_many_to_many_api(source_client):
    client, pipeline = source_client
    created = client.post(
        "/sources",
        json={
            "title": "锦心策原稿",
            "source_type": "markdown",
            "original_filename": "jinxin.md",
            "encoding": "utf-8",
            "summary": "第一季原始资料",
            "metadata": {"author": "test"},
        },
    )
    assert created.status_code == 201, created.text
    source = created.json()
    assert source["chapter_count"] == 0
    assert source["metadata"] == {"author": "test"}

    chapter = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 1, "title": "初见", "content": "她推门而入。"},
    )
    assert chapter.status_code == 201, chapter.text
    chapter_payload = chapter.json()
    revision = chapter_payload["current_revision"]
    assert revision["revision_number"] == 1
    assert revision["content_sha256"] == hashlib.sha256("她推门而入。".encode()).hexdigest()

    second = client.post(
        f"/sources/{source['id']}/chapters/{chapter_payload['id']}/revisions",
        json={"content": "她缓步推门而入。", "metadata": {"editor": "owner"}},
    )
    assert second.status_code == 201, second.text
    assert second.json()["revision_number"] == 2
    history = client.get(f"/sources/{source['id']}/chapters/{chapter_payload['id']}/revisions")
    assert [item["revision_number"] for item in history.json()["items"]] == [2, 1]
    assert client.get(f"/sources/{source['id']}").json()["chapters"][0]["revision_count"] == 2

    project = pipeline.create_project("来源绑定剧集", "正文", skip_analysis=True)
    # Resolve the authenticated workspace from the service rather than a
    # transport cookie; workspace IDs are intentionally not client cookies.
    episode_id = project.id
    workspace_id = api_module.app.state.auth_service.repository.get_default_workspace(
        api_module.app.state.auth_service.repository.find_user_by_username("owner").id
    ).id
    pipeline.repository.assign_workspace_for_script(episode_id, workspace_id)
    linked = client.post(f"/sources/{source['id']}/episodes/{episode_id}")
    assert linked.status_code == 201, linked.text
    assert linked.json()["created"] is True
    assert client.get(f"/sources/{source['id']}/episodes").json()["total"] == 1
    assert client.get(f"/episodes/{episode_id}/sources").json()["total"] == 1
    duplicate = client.post(f"/sources/{source['id']}/episodes/{episode_id}")
    assert duplicate.status_code == 201 and duplicate.json()["created"] is False
    assert client.delete(f"/sources/{source['id']}/episodes/{episode_id}").json()["created"] is False


def test_source_errors_are_stable_and_workspace_scoped(source_client):
    client, _ = source_client
    missing = client.get("/sources/not-found")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "AUTH_RESOURCE_NOT_FOUND"
    assert missing.json()["error"]["request_id"].startswith("req_")

    invalid = client.post("/sources", json={"title": ""})
    assert invalid.status_code == 422
    source = client.post("/sources", json={"title": "有效来源"}).json()
    invalid_chapter = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 1, "title": " ", "content": " "},
    )
    assert invalid_chapter.status_code == 422
