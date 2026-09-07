from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

import src.apps.comic_gen.api as api_module
from src.apps.comic_gen.auth.service import AuthService
from src.apps.comic_gen.auth.settings import AuthSettings
from src.apps.comic_gen.models import Prop, VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.storage.auth_repository import AuthRepository
from src.storage.errors import StorageError
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
        cookie_secure=False,
        allowed_origins=("http://testserver",),
        app_env="test",
    )
    service = AuthService(AuthRepository(isolated_pipeline.storage_engine), settings)

    previous_pipeline = api_module.pipeline
    previous_media_root = api_module.MEDIA_PROJECT_ROOT
    previous_engine = api_module.app.state.storage_engine
    previous_service = api_module.app.state.auth_service
    previous_settings = api_module.app.state.auth_settings
    api_module.pipeline = isolated_pipeline
    api_module.MEDIA_PROJECT_ROOT = tmp_path.resolve()
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
        api_module.MEDIA_PROJECT_ROOT = previous_media_root
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


@pytest.mark.parametrize("outcome", ["completed", "provider-error", "deleted"])
def test_first_frame_render_survives_project_refresh_and_keeps_candidate_history(api_client, outcome):
    from src.apps.comic_gen.storyboard import StoryboardGenerator

    project = _create_project(api_client, "First frame render")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Original prompt"}).json()["frames"][0]["id"]
    response = api_client.patch(route + f"/frames/{frame_id}/workbench", json={"t2i_image_urls": ["storyboard/previous.png"], "t2i_selected_index": 0})
    assert response.status_code == 200, response.text

    def generate(prompt, output_path, **kwargs):
        assert api_client.get(route).status_code == 200
        edited = api_client.post(route + "/frames/update", json={"frame_id": frame_id, "action_description": "Edited while image was rendering"})
        assert edited.status_code == 200, edited.text
        if outcome == "provider-error":
            raise RuntimeError("Image provider unavailable")
        if outcome == "deleted":
            assert api_client.delete(route + f"/frames/{frame_id}").status_code == 200
        Path(output_path).write_bytes(b"image-provider-fixture")

    with patch("src.apps.comic_gen.storyboard.WanxImageModel") as model, patch("src.utils.oss_utils.OSSImageUploader") as uploader:
        model.return_value.generate.side_effect = generate
        uploader.return_value.is_configured = False
        api_module.pipeline.storyboard_generator = StoryboardGenerator()
        response = api_client.post(route + "/storyboard/render", json={"frame_id": frame_id, "prompt": "A station in the rain"})
    assert response.status_code == {"completed": 200, "provider-error": 500, "deleted": 404}[outcome], response.text
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    if outcome == "deleted":
        assert api_client.get(route).json()["frames"] == []
        return
    restored = api_client.get(route).json()["frames"][0]
    if outcome == "provider-error":
        assert restored["status"] == "failed"
        assert restored["image_error"] == "Image provider unavailable"
        assert restored["t2i_image_urls"] == ["storyboard/previous.png"]
        assert restored["action_description"] == "Edited while image was rendering"
        return
    assert restored["status"] == "completed"
    assert restored["action_description"] == "Edited while image was rendering"
    assert restored["t2i_image_urls"] == ["storyboard/previous.png", restored["rendered_image_url"]]
    assert restored["t2i_selected_index"] == 1
    assert Path("output", restored["rendered_image_url"]).read_bytes() == b"image-provider-fixture"


def _add_episode(client, series_id: str, script_id: str, episode_number: int) -> None:
    response = client.post(
        f"/series/{series_id}/episodes",
        json={"script_id": script_id, "episode_number": episode_number},
    )
    assert response.status_code == 200, response.text


def test_list_projects_uses_canonical_path_without_trailing_slash(api_client):
    project = _create_project(api_client, "列表接口回归")

    response = api_client.get("/projects", follow_redirects=False)

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()] == [project["id"]]


def test_frame_visual_prompt_round_trips_without_overwriting_legacy_action(api_client):
    project = _create_project(api_client, "Prompt persistence")
    route = f"/projects/{project['id']}"
    created = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Coarse action"})
    assert created.status_code == 200, created.text
    frame_id = created.json()["frames"][0]["id"]
    for prompt in ["Refined visual narrative", ""]:
        saved = api_client.post(route + "/frames/update", json={"frame_id": frame_id, "visual_description": prompt})
        assert saved.status_code == 200, saved.text
        frame = api_client.get(route).json()["frames"][0]
        assert frame["visual_description"] == prompt
        assert frame["action_description"] == "Coarse action"
        if prompt:
            assert prompt in frame["assembled_prompt"]
        else:
            assert "Refined visual narrative" not in frame["assembled_prompt"]
    invalid = api_client.post(route + "/frames/update", json={"frame_id": frame_id, "visual_description": {"invalid": True}})
    assert invalid.status_code == 422


def test_script_document_uses_current_project_storage(api_client, tmp_path):
    project = _create_project(api_client, "剧本文档保存回归")
    content = {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": "第一场"}]}],
    }

    empty_document = api_client.get(f"/projects/{project['id']}/document")
    empty_snapshots = api_client.get(f"/projects/{project['id']}/document/snapshots")

    assert empty_document.status_code == 200, empty_document.text
    assert empty_document.json() == {
        "type": "doc",
        "content": [{
            "type": "action",
            "content": [{"type": "text", "text": "剧本文档保存回归正文"}],
        }],
    }
    assert empty_snapshots.status_code == 200, empty_snapshots.text
    assert empty_snapshots.json() == []

    saved = api_client.post(
        f"/projects/{project['id']}/document",
        json={"content": content},
    )

    assert saved.status_code == 200, saved.text
    assert saved.json()["status"] == "ok"

    loaded = api_client.get(f"/projects/{project['id']}/document")

    assert loaded.status_code == 200, loaded.text
    assert loaded.json() == content
    assert (
        tmp_path / "output" / "documents" / project["id"] / "document.json"
    ).is_file()


def test_provider_configuration_is_isolated_by_workspace(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    saved = api_client.post(
        "/config/env",
        json={
            "DASHSCOPE_API_KEY": "team-secret",
            "OSS_BASE_PATH": "team-only",
        },
    )
    assert saved.status_code == 200, saved.text
    team_config = api_client.get("/config/env").json()
    assert team_config["secrets_configured"]["DASHSCOPE_API_KEY"] is True
    assert team_config["OSS_BASE_PATH"] == "team-only"

    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Personal Workspace"},
    )
    assert personal.status_code == 201, personal.text
    personal_id = personal.json()["id"]
    assert personal_id != team_id

    personal_config = api_client.get(
        "/config/env",
        headers={"X-Workspace-ID": personal_id},
    )
    assert personal_config.status_code == 200, personal_config.text
    assert personal_config.json()["secrets_configured"]["DASHSCOPE_API_KEY"] is False
    assert personal_config.json()["OSS_BASE_PATH"] == ""


def test_auth_me_ignores_a_stale_workspace_selection(api_client):
    response = api_client.get(
        "/auth/me",
        headers={"X-Workspace-ID": "workspace-no-longer-accessible"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["user"]["username"] == "owner"


def test_local_upload_is_readable_only_in_its_workspace(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    disabled_oss = api_client.post("/config/env", json={"OSS_ENABLE": False})
    assert disabled_oss.status_code == 200, disabled_oss.text

    uploaded = api_client.post(
        "/upload",
        files={"file": ("sample.png", b"image-bytes", "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    path = uploaded.json()["url"]
    assert path.startswith(f"uploads/{team_id}/")
    assert api_client.get(f"/files/{path}").status_code == 200

    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Upload Isolation"},
    ).json()
    hidden = api_client.get(
        f"/files/{path}",
        headers={"X-Workspace-ID": personal["id"]},
    )
    assert hidden.status_code == 404


def test_task_status_is_hidden_from_other_workspaces(api_client):
    project = _create_project(api_client, "任务隔离")
    api_module.pipeline.asset_generation_tasks["team-task"] = {
        "status": "pending",
        "script_id": project["id"],
        "asset_id": "asset-1",
        "asset_type": "prop",
        "created_at": 1.0,
    }
    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Other Workspace"},
    ).json()

    hidden = api_client.get(
        "/tasks/team-task",
        headers={"X-Workspace-ID": personal["id"]},
    )

    assert hidden.status_code == 404


def test_playground_history_templates_and_media_are_workspace_scoped(api_client):
    from datetime import datetime, timezone

    from src.apps.playground import api as playground_api
    from src.apps.playground.models import (
        PlaygroundGeneration,
        PlaygroundMode,
        PlaygroundOutput,
        PlaygroundTemplate,
    )
    from src.apps.playground.service import PlaygroundService
    from src.apps.playground.storage import PlaygroundStorage

    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Playground Isolation"},
    ).json()
    other_id = personal["id"]
    now = datetime.now(timezone.utc).isoformat()
    storage = PlaygroundStorage()
    storage.HISTORY_PATH = "output/test_playground_history.json"
    storage.TEMPLATES_PATH = "output/test_playground_templates.json"
    storage._history = []
    storage._templates = []

    team_path = f"output/playground/images/{team_id}/team.png"
    other_path = f"output/playground/images/{other_id}/other.png"
    for workspace_id, generation_id, media_path in (
        (team_id, "team-generation", team_path),
        (other_id, "other-generation", other_path),
    ):
        path = api_module.MEDIA_PROJECT_ROOT / media_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(workspace_id.encode("utf-8"))
        storage.add_generation(
            PlaygroundGeneration(
                id=generation_id,
                workspace_id=workspace_id,
                mode=PlaygroundMode.T2I,
                model_id="wan2.7-image-pro",
                prompt=workspace_id,
                outputs=[
                    PlaygroundOutput(
                        id=f"{generation_id}-output",
                        media_path=media_path,
                        media_type="image",
                    )
                ],
                created_at=now,
            )
        )
        storage.add_template(
            PlaygroundTemplate(
                id=f"{generation_id}-template",
                workspace_id=workspace_id,
                name=workspace_id,
                prompt=workspace_id,
                created_at=now,
                updated_at=now,
            )
        )
    storage.add_template(
        PlaygroundTemplate(
            id="legacy-template",
            name="Legacy",
            prompt="Legacy",
            created_at=now,
            updated_at=now,
        )
    )

    previous_storage, previous_service = playground_api._storage, playground_api._service
    playground_api._storage = storage
    playground_api._service = PlaygroundService(storage)
    try:
        team_history = api_client.get("/playground/history")
        other_headers = {"X-Workspace-ID": other_id}
        other_history = api_client.get("/playground/history", headers=other_headers)
        hidden_generation = api_client.get(
            "/playground/history/team-generation",
            headers=other_headers,
        )
        hidden_delete = api_client.delete(
            "/playground/history/team-generation",
            headers=other_headers,
        )
        team_templates = api_client.get("/playground/templates")
        team_media = api_client.get(f"/files/{team_path.removeprefix('output/')}")
        hidden_media = api_client.get(
            f"/files/{team_path.removeprefix('output/')}",
            headers=other_headers,
        )
        hidden_input = api_client.post(
            "/playground/generate",
            headers=other_headers,
            json={
                "mode": "i2i",
                "model_id": "wan2.7-image-pro",
                "prompt": "cross workspace",
                "input_media": [team_path],
            },
        )
        uploaded = api_client.post(
            "/playground/upload",
            files={"file": ("reference.png", b"reference", "image/png")},
        )
        uploaded_path = uploaded.json()["path"]
        uploaded_media = api_client.get(
            f"/files/{uploaded_path.removeprefix('output/')}",
        )
        hidden_upload = api_client.get(
            f"/files/{uploaded_path.removeprefix('output/')}",
            headers=other_headers,
        )

        assert [item["id"] for item in team_history.json()] == ["team-generation"]
        assert [item["id"] for item in other_history.json()] == ["other-generation"]
        assert hidden_generation.status_code == 404
        assert hidden_delete.status_code == 404
        assert [item["id"] for item in team_templates.json()] == [
            "team-generation-template",
            "legacy-template",
        ]
        assert team_media.status_code == 200
        assert hidden_media.status_code == 404
        assert hidden_input.status_code == 404
        assert uploaded.status_code == 200
        assert f"playground/uploads/{team_id}/" in uploaded_path
        assert uploaded_media.status_code == 200
        assert hidden_upload.status_code == 404
    finally:
        playground_api._storage = previous_storage
        playground_api._service = previous_service


def test_voice_writes_cannot_target_a_series_in_another_workspace(api_client):
    series = api_client.post("/series", json={"title": "Team Series"}).json()
    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Voice Isolation"},
    ).json()
    headers = {"X-Workspace-ID": personal["id"]}

    clone = api_client.post(
        "/voice/clone",
        headers=headers,
        json={
            "series_id": series["id"],
            "audio_url": "uploads/sample.wav",
            "label": "Foreign Clone",
        },
    )
    accept = api_client.post(
        "/voice/design/accept",
        headers=headers,
        json={
            "series_id": series["id"],
            "voice_id": "foreign-voice",
            "voice_prompt": "低沉",
            "label": "Foreign Design",
        },
    )

    assert clone.status_code == 404
    assert accept.status_code == 404


def test_imported_series_and_episodes_are_assigned_to_active_workspace(api_client):
    workspace_id = api_client.get("/auth/me").json()["workspace"]["id"]
    response = api_client.post(
        "/series/import/confirm",
        json={
            "title": "导入系列",
            "text": "第一集正文",
            "episodes": [
                {
                    "episode_number": 1,
                    "title": "第一集",
                    "start_marker": "第一集正文",
                    "end_marker": "第一集正文",
                }
            ],
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert api_module.pipeline.repository.workspace_for_series(payload["series"]["id"]) == workspace_id
    assert api_module.pipeline.repository.workspace_for_script(payload["episodes"][0]["id"]) == workspace_id


def test_import_preview_cache_cannot_cross_workspaces(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    api_module.pipeline._import_cache["team-import"] = (team_id, "团队原文")
    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Import Isolation"},
    ).json()

    response = api_client.post(
        "/series/import/confirm",
        headers={"X-Workspace-ID": personal["id"]},
        json={"title": "越权导入", "import_id": "team-import", "episodes": []},
    )

    assert response.status_code == 400
    assert "team-import" in api_module.pipeline._import_cache


def test_legacy_unscoped_library_assets_move_to_default_workspace(api_client):
    workspace_id = api_client.get("/auth/me").json()["workspace"]["id"]
    legacy = Prop(id="legacy-prop", name="遗留道具", description="升级前资产")
    api_module.pipeline.library_store.props.append(legacy)
    api_module.pipeline._save_library_data()

    response = api_client.get("/library/assets")

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["props"]] == ["legacy-prop"]
    assert legacy.workspace_id == workspace_id


def test_member_can_read_team_projects_but_cannot_create_top_level_project(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    project = _create_project(api_client, "Owner 创建的项目")
    series_response = api_client.post("/series", json={"title": "Owner 创建的系列"})
    assert series_response.status_code == 200, series_response.text
    series_id = series_response.json()["id"]
    shared_prop = api_client.post(
        "/library/assets",
        json={"asset_type": "prop", "name": "共享道具"},
    ).json()
    invitation = api_client.post(
        f"/auth/workspaces/{team_id}/invitations",
        json={"email": "writer@example.com"},
    )
    assert invitation.status_code == 201, invitation.text

    with make_client(api_module.app) as writer:
        registered = writer.post(
            "/auth/invitations/register",
            json={
                "token": invitation.json()["token"],
                "username": "writer",
                "email": "writer@example.com",
                "password": "writer password 123",
            },
        )
        assert registered.status_code == 201, registered.text
        workspace_headers = {"X-Workspace-ID": team_id}

        visible = writer.get("/projects", headers=workspace_headers)
        assert visible.status_code == 200, visible.text
        assert [item["id"] for item in visible.json()] == [project["id"]]

        forbidden = writer.post(
            "/projects?skip_analysis=true",
            headers=workspace_headers,
            json={"title": "成员越权创建", "text": "不应创建"},
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        rename_series = writer.put(
            f"/series/{series_id}",
            headers=workspace_headers,
            json={"title": "成员越权改名"},
        )
        assert rename_series.status_code == 403
        assert rename_series.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        import_series = writer.post(
            "/series/import/confirm",
            headers=workspace_headers,
            json={"title": "成员越权导入", "text": "正文", "episodes": []},
        )
        assert import_series.status_code == 403
        assert import_series.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        shared_mutation = writer.post(
            f"/projects/{project['id']}/assets/toggle_starred",
            headers=workspace_headers,
            json={"asset_id": shared_prop["id"], "asset_type": "prop"},
        )
        assert shared_mutation.status_code == 403
        assert shared_mutation.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        diagnostics = writer.get("/diagnose/log_tail", headers=workspace_headers)
        assert diagnostics.status_code == 403
        assert diagnostics.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        members = writer.get(f"/auth/workspaces/{team_id}/members")
        assert members.status_code == 403
        assert members.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

    shared_after = api_client.get("/library/assets").json()["props"]
    assert next(item for item in shared_after if item["id"] == shared_prop["id"])["starred"] is False


def test_episode_edit_lease_blocks_second_editor_and_text_save_uses_cas(api_client):
    project = _create_project(api_client, "并发写作")
    project_id = project["id"]
    revision = api_client.get(f"/projects/{project_id}").json()["_revision"]

    acquired = api_client.post(
        f"/projects/{project_id}/edit-lease",
        json={"client_instance_id": "browser-a"},
    )
    assert acquired.status_code == 200, acquired.text
    lease = acquired.json()

    with make_client(api_module.app, local=True) as second_browser:
        login = second_browser.post(
            "/auth/login",
            json={
                "identifier": "owner",
                "password": "correct horse battery staple",
            },
        )
        assert login.status_code == 200, login.text
        blocked = second_browser.post(
            f"/projects/{project_id}/edit-lease",
            json={"client_instance_id": "browser-b"},
        )
        assert blocked.status_code == 423
        assert blocked.json()["error"]["code"] == "EDIT_LEASE_HELD"
        assert blocked.json()["lease"]["holder_display_name"] == "owner"

        blocked_mutation = second_browser.patch(
            f"/projects/{project_id}/style",
            headers={"X-Client-Instance-ID": "browser-b"},
            json={"style_preset": "anime"},
        )
        assert blocked_mutation.status_code == 423
        assert blocked_mutation.json()["error"]["code"] == "EDIT_LEASE_HELD"
        assert blocked_mutation.json()["lease"]["holder_display_name"] == "owner"

    saved = api_client.put(
        f"/projects/{project_id}/text",
        headers={"X-Edit-Lease": lease["token"]},
        json={
            "text": "A 保存的新内容",
            "expected_revision": revision,
            "client_instance_id": "browser-a",
        },
    )
    assert saved.status_code == 200, saved.text
    new_revision = saved.json()["_revision"]

    stale = api_client.put(
        f"/projects/{project_id}/text",
        headers={"X-Edit-Lease": lease["token"]},
        json={
            "text": "旧页面覆盖",
            "expected_revision": revision,
            "client_instance_id": "browser-a",
        },
    )
    assert stale.status_code == 409
    assert stale.json()["current_revision"] == new_revision
    assert api_client.get(f"/projects/{project_id}").json()["original_text"] == "A 保存的新内容"


def test_member_can_release_own_episode_edit_lease(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    project = _create_project(api_client, "成员释放编辑锁")
    invitation = api_client.post(
        f"/auth/workspaces/{team_id}/invitations",
        json={"email": "lease-writer@example.com"},
    )
    assert invitation.status_code == 201, invitation.text

    with make_client(api_module.app) as writer:
        registered = writer.post(
            "/auth/invitations/register",
            json={
                "token": invitation.json()["token"],
                "username": "lease-writer",
                "email": "lease-writer@example.com",
                "password": "writer password 123",
            },
        )
        assert registered.status_code == 201, registered.text
        workspace_headers = {"X-Workspace-ID": team_id}
        acquired = writer.post(
            f"/projects/{project['id']}/edit-lease",
            headers=workspace_headers,
            json={"client_instance_id": "writer-browser"},
        )
        assert acquired.status_code == 200, acquired.text

        released = writer.request(
            "DELETE",
            f"/projects/{project['id']}/edit-lease",
            headers={
                **workspace_headers,
                "X-Edit-Lease": acquired.json()["token"],
            },
            json={"client_instance_id": "writer-browser"},
        )

    assert released.status_code == 204, released.text
    reacquired = api_client.post(
        f"/projects/{project['id']}/edit-lease",
        json={"client_instance_id": "owner-browser"},
    )
    assert reacquired.status_code == 200, reacquired.text


def test_shared_library_is_isolated_by_workspace(api_client):
    primary = api_client.get("/auth/me").json()["workspace"]
    created = api_client.post(
        "/library/assets",
        headers={"X-Workspace-ID": primary["id"]},
        json={"asset_type": "prop", "name": "团队道具"},
    )
    assert created.status_code == 200, created.text

    second = api_client.post("/auth/workspaces", json={"name": "另一个团队"})
    assert second.status_code == 201, second.text
    second_id = second.json()["id"]
    isolated = api_client.get("/library/assets", headers={"X-Workspace-ID": second_id})
    assert isolated.status_code == 200, isolated.text
    assert isolated.json() == {"characters": [], "scenes": [], "props": []}

    primary_assets = api_client.get(
        "/library/assets",
        headers={"X-Workspace-ID": primary["id"]},
    )
    assert [item["name"] for item in primary_assets.json()["props"]] == ["团队道具"]


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


@pytest.mark.parametrize("operation", ["annotate", "select_video", "auto_select_latest_video", "unpin_video"])
def test_candidate_save_failure_retains_confirmed_state_and_retry_round_trips(api_client, operation):
    project = _create_project(api_client, "Candidate save recovery")
    route = f"/projects/{project['id']}"
    created = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "A rooftop"})
    frame_id = created.json()["frames"][0]["id"]
    # Completed provider results are fixtures; no generation is dispatched.
    script = api_module.pipeline.scripts[project["id"]]
    script.video_tasks = [VideoTask(id="take-new", project_id=script.id, frame_id=frame_id,
        image_url="", prompt="A rooftop", status="completed", video_url="video/new.mp4")]
    frame = script.frames[0]
    frame.selected_video_id = "take-old"
    frame.video_url = "video/old.mp4"
    frame.is_video_pinned = operation == "unpin_video"
    api_module.pipeline._save_data()
    before = api_client.get(route).json()
    endpoint = route + "/video_tasks/take-new/annotate" if operation == "annotate" else route + f"/frames/{frame_id}/{operation}"
    method = api_client.patch if operation == "annotate" else api_client.post
    payload = {"is_starred": True, "label": "Best camera"} if operation == "annotate" else {"video_id": "take-new"} if operation == "select_video" else {}
    with patch.object(api_module.pipeline.repository, "save_scripts", side_effect=StorageError("simulated write failure")):
        failed = method(endpoint, json=payload)
    assert failed.status_code == 500, failed.text
    unchanged = api_client.get(route).json()
    assert unchanged["frames"] == before["frames"]
    assert unchanged["video_tasks"] == before["video_tasks"]
    saved = method(endpoint, json=payload)
    assert saved.status_code == 200, saved.text
    # Reload the isolated repository as a backend restart would, then read via API.
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    restored = api_client.get(route).json()
    if operation == "annotate":
        assert restored["video_tasks"][0]["is_starred"] is True
        assert restored["video_tasks"][0]["label"] == "Best camera"
    elif operation == "unpin_video":
        assert restored["frames"][0]["is_video_pinned"] is False
        assert restored["frames"][0]["video_url"] == "video/old.mp4"
    else:
        assert restored["frames"][0]["selected_video_id"] == "take-new"
        assert restored["frames"][0]["video_url"] == "video/new.mp4"
        assert restored["frames"][0]["is_video_pinned"] is (operation == "select_video")


def test_video_selection_rejects_unusable_or_unrelated_candidates_without_changing_the_frame(api_client):
    project = _create_project(api_client, "Candidate ownership")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Target shot"}).json()["frames"][0]["id"]
    other_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Other shot"}).json()["frames"][1]["id"]
    script = api_module.pipeline.scripts[project["id"]]
    base = dict(project_id=script.id, frame_id=frame_id, image_url="", prompt="Candidate", status="completed", video_url="video/new.mp4")
    script.video_tasks = [VideoTask(id="usable", **base)] + [
        VideoTask(id=name, **{**base, **changes}) for name, changes in [
            ("pending", {"status": "pending"}), ("processing", {"status": "processing"}),
            ("failed", {"status": "failed"}), ("no-media", {"video_url": None}),
            ("other-frame", {"frame_id": other_id}), ("unassigned", {"frame_id": None}),
            ("other-project", {"project_id": "another-project"}),
        ]
    ]
    script.frames[0].selected_video_id = "previous"
    script.frames[0].video_url = "video/previous.mp4"
    api_module.pipeline._save_data()
    before = api_client.get(route).json()["frames"]
    endpoint = route + f"/frames/{frame_id}/select_video"
    for task in script.video_tasks[1:]:
        response = api_client.post(endpoint, json={"video_id": task.id})
        assert response.status_code == 400, (task.id, response.text)
        assert api_client.get(route).json()["frames"] == before
    missing = api_client.post(endpoint, json={"video_id": "missing"})
    assert missing.status_code == 404
    saved = api_client.post(endpoint, json={"video_id": "usable"})
    assert saved.status_code == 200, saved.text
    frame = api_client.get(route).json()["frames"][0]
    assert frame["selected_video_id"] == "usable"
    assert frame["video_url"] == "video/new.mp4"
    assert frame["is_video_pinned"] is True


def test_automatic_selection_uses_creation_order_and_ignores_unrelated_tasks(api_client):
    project = _create_project(api_client, "Automatic candidates")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Target shot"}).json()["frames"][0]["id"]
    script = api_module.pipeline.scripts[project["id"]]
    base = dict(project_id=script.id, frame_id=frame_id, image_url="", prompt="Candidate", status="completed")
    script.video_tasks = [
        VideoTask(id="newer", video_url="video/newer.mp4", created_at=200, **base),
        VideoTask(id="older-finished-last", video_url="video/older.mp4", created_at=100, **base),
        VideoTask(id="wrong-project", video_url="video/wrong.mp4", created_at=300, **{**base, "project_id": "other-project"}),
        VideoTask(id="missing-media", created_at=400, **base),
    ]
    api_module.pipeline._save_data()
    response = api_client.post(route + f"/frames/{frame_id}/auto_select_latest_video")
    assert response.status_code == 200, response.text
    frame = api_client.get(route).json()["frames"][0]
    assert frame["selected_video_id"] == "newer"
    assert frame["video_url"] == "video/newer.mp4"
    assert frame["is_video_pinned"] is False


def test_video_retry_preserves_saved_inputs_and_recovers_without_duplicate_dispatch(api_client):
    project = _create_project(api_client, "Historical retry")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Original shot"}).json()["frames"][0]["id"]
    script = api_module.pipeline.scripts[project["id"]]
    script.frames[0].dialogue = "Original dialogue"
    api_module.pipeline._save_data()
    with patch.object(api_module.pipeline, "process_video_task") as process:
        created = api_client.post(route + "/video_tasks", json={
            "frame_id": frame_id, "image_url": "", "prompt": "Original camera move", "model": "wan2.7-r2v",
            "duration": 8, "resolution": "1080p", "seed": 0, "shot_type": "multi", "generation_mode": "r2v",
            "generate_audio": True, "audio_url": "audio/original.wav", "prompt_extend": False,
            "negative_prompt": "Original exclusions", "reference_video_urls": ["video/reference.mp4"],
            "reference_image_urls": ["assets/original.png"], "ratio": "9:16", "watermark": False,
            "mode": "pro", "sound": "on", "cfg_scale": 0, "vidu_audio": False,
            "movement_amplitude": "small", "workbench_tab": "direct_r2v",
        })
        assert created.status_code == 200, created.text
        task_id = created.json()[0]["id"]
        script = api_module.pipeline.scripts[project["id"]]
        source = next(task for task in script.video_tasks if task.id == task_id)
        source.status, source.error = "failed", "Original provider failure"
        source.provider_name, source.provider_task_id, source.provider_request_id = "dashscope", "old-provider-task", "old-request"
        source.is_starred, source.label, source.audio_setting = True, "Keep this note", "origin"
        script.frames[0].dialogue = "Changed dialogue"
        script.frames[0].action_description = "Changed camera move"
        api_module.pipeline._save_data()
        before = api_client.get(route).json()
        process.reset_mock()
        endpoint = route + f"/video_tasks/{task_id}/retry"
        with patch.object(api_module.pipeline.repository, "save_scripts", side_effect=StorageError("write unavailable")):
            failed = api_client.post(endpoint)
        assert failed.status_code == 500, failed.text
        process.assert_not_called()
        assert api_client.get(route).json()["video_tasks"] == before["video_tasks"]
        retried = api_client.post(endpoint)
        assert retried.status_code == 200, retried.text
        new = retried.json()
        volatile = {"id", "status", "error", "video_url", "created_at", "provider_name", "provider_task_id", "provider_request_id", "is_starred", "label", "retry_of_task_id"}
        assert {key: value for key, value in new.items() if key not in volatile} == {key: value for key, value in before["video_tasks"][0].items() if key not in volatile}
        assert "Original dialogue" in new["prompt"] and "Changed dialogue" not in new["prompt"]
        assert new["retry_of_task_id"] == task_id and new["id"] != task_id
        assert new["status"] == "pending" and new["is_starred"] is False
        assert all(new[key] is None for key in ["error", "video_url", "label", "provider_name", "provider_task_id", "provider_request_id"])
        process.assert_called_once_with(project["id"], new["id"])
        assert api_client.post(endpoint).json()["id"] == new["id"]
        process.assert_called_once()
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    restored = api_client.get(route).json()
    assert restored["frames"] == before["frames"]
    assert restored["video_tasks"][0] == before["video_tasks"][0]
    assert restored["video_tasks"][1] == new


@pytest.mark.parametrize("case", ["pending", "completed", "missing-frame", "unknown-task", "foreign-workspace"])
def test_video_retry_rejects_unavailable_tasks_without_dispatch(api_client, case):
    project = _create_project(api_client, "Retry scope")
    script = api_module.pipeline.scripts[project["id"]]
    script.video_tasks = [VideoTask(id="old-task", project_id=script.id, image_url="", prompt="Saved prompt",
        status=case if case in {"pending", "completed"} else "failed", frame_id="deleted-frame" if case == "missing-frame" else None)]
    api_module.pipeline._save_data()
    headers = {}
    if case == "foreign-workspace":
        workspace = api_client.post("/auth/workspaces", json={"name": "Another workspace"}).json()
        headers = {"X-Workspace-ID": workspace["id"]}
    task_id = "unknown" if case == "unknown-task" else "old-task"
    with patch.object(api_module.pipeline, "process_video_task") as process:
        response = api_client.post(f"/projects/{script.id}/video_tasks/{task_id}/retry", headers=headers)
        assert response.status_code == (404 if case in {"unknown-task", "foreign-workspace"} else 400), response.text
        process.assert_not_called()
    assert len(api_module.pipeline.scripts[script.id].video_tasks) == 1


def test_video_completion_persists_and_adopts_after_project_read_and_edit_without_a_workbench(api_client):
    project = _create_project(api_client, "Background completion")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Original description"}).json()["frames"][0]["id"]

    def generate(**kwargs):
        # A real project read replaces the cached project while the provider runs.
        running = api_client.get(route).json()
        assert running["video_tasks"][0]["status"] == "processing"
        kwargs["on_provider_ids"]("dashscope", "provider-task-fixture", "request-fixture")
        assert api_client.get(route).json()["video_tasks"][0]["provider_task_id"] == "provider-task-fixture"
        edited = api_client.post(route + "/frames/update", json={"frame_id": frame_id, "action_description": "Edited during generation"})
        assert edited.status_code == 200, edited.text
        Path(kwargs["output_path"]).write_bytes(b"provider-result-fixture")
        return kwargs["output_path"], None

    api_module.pipeline.video_generator.model.generate.side_effect = generate
    response = api_client.post(route + "/video_tasks", json={"frame_id": frame_id, "image_url": "", "prompt": "Saved camera move", "model": "wan2.7-t2v", "generation_mode": "t2v"})
    assert response.status_code == 200, response.text
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    restored = api_client.get(route).json()
    task = restored["video_tasks"][0]
    frame = restored["frames"][0]
    assert task["status"] == "completed"
    assert Path("output", task["video_url"]).read_bytes() == b"provider-result-fixture"
    assert frame["selected_video_id"] == task["id"]
    assert frame["video_url"] == task["video_url"]
    assert frame["is_video_pinned"] is False
    assert frame["action_description"] == "Edited during generation"


@pytest.mark.parametrize("intervention", ["pin", "lock", "cancel", "delete-frame", "provider-error", "save-error"])
def test_video_completion_preserves_changes_made_while_provider_is_running(api_client, intervention):
    project = _create_project(api_client, "Completion protections")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Keep this shot"}).json()["frames"][0]["id"]
    script = api_module.pipeline.scripts[project["id"]]
    script.video_tasks = [VideoTask(id="previous", project_id=script.id, frame_id=frame_id, image_url="", prompt="Previous", status="completed", video_url="video/previous.mp4", created_at=1)]
    script.frames[0].selected_video_id = "previous"
    script.frames[0].video_url = "video/previous.mp4"
    api_module.pipeline._save_data()
    saved = api_module.pipeline.repository.save_scripts
    failed_save = False

    def save_scripts(scripts):
        nonlocal failed_save
        task = scripts[project["id"]].video_tasks[-1]
        if intervention == "save-error" and task.status == "completed" and not failed_save:
            failed_save = True
            raise StorageError("simulated completion persistence failure")
        return saved(scripts)

    def generate(**kwargs):
        running = api_client.get(route).json()
        task_id = running["video_tasks"][-1]["id"]
        if intervention == "pin":
            response = api_client.post(route + f"/frames/{frame_id}/select_video", json={"video_id": "previous"})
        elif intervention == "lock":
            response = api_client.post(route + "/frames/toggle_lock", json={"frame_id": frame_id})
        elif intervention == "cancel":
            response = api_client.post(route + f"/video_tasks/{task_id}/cancel")
        elif intervention == "delete-frame":
            response = api_client.delete(route + f"/frames/{frame_id}")
        elif intervention == "provider-error":
            raise RuntimeError("Provider temporarily unavailable")
        else:
            response = None
        if response is not None:
            assert response.status_code == 200, response.text
        Path(kwargs["output_path"]).write_bytes(b"provider-result-fixture")
        return kwargs["output_path"], None

    api_module.pipeline.video_generator.model.generate.side_effect = generate
    with patch.object(api_module.pipeline.repository, "save_scripts", side_effect=save_scripts):
        response = api_client.post(route + "/video_tasks", json={"frame_id": frame_id, "image_url": "", "prompt": "Camera move", "model": "wan2.7-t2v", "generation_mode": "t2v"})
    assert response.status_code == 200, response.text
    restored = api_client.get(route).json()
    task = restored["video_tasks"][-1]
    if intervention in ("cancel", "provider-error", "save-error"):
        assert task["status"] == "failed"
        assert task["error"] == {"cancel": "Canceled by user", "provider-error": "Provider temporarily unavailable", "save-error": "simulated completion persistence failure"}[intervention]
        if intervention == "save-error":
            assert task["video_url"]
            assert Path("output", task["video_url"]).read_bytes() == b"provider-result-fixture"
    else:
        assert task["status"] == "completed"
    if intervention == "delete-frame":
        assert restored["frames"] == []
    else:
        frame = restored["frames"][0]
        assert frame["selected_video_id"] == "previous"
        assert frame["video_url"] == "video/previous.mp4"
        assert frame["is_video_pinned"] is (intervention == "pin")
        assert frame["locked"] is (intervention == "lock")


def test_video_retry_reports_processing_failure_and_keeps_original_task(api_client):
    project = _create_project(api_client, "Retry provider failure")
    script = api_module.pipeline.scripts[project["id"]]
    original = VideoTask(id="failed-original", project_id=script.id, image_url="", prompt="Saved camera move",
        status="failed", error="Original failure", seed=0, prompt_extend=False)
    script.video_tasks = [original]
    api_module.pipeline._save_data()
    # Exercise the real processor while replacing only the provider's generate boundary.
    generate = api_module.pipeline.video_generator.model.generate
    generate.side_effect = RuntimeError("Provider temporarily unavailable")
    response = api_client.post(f"/projects/{script.id}/video_tasks/{original.id}/retry")
    assert response.status_code == 200, response.text
    tasks = api_client.get(f"/projects/{script.id}").json()["video_tasks"]
    assert tasks[0]["error"] == "Original failure"
    assert tasks[1]["status"] == "failed"
    assert tasks[1]["error"] == "Provider temporarily unavailable"
    assert generate.call_args.kwargs["prompt"] == "Saved camera move"
    assert generate.call_args.kwargs["seed"] == 0
    assert generate.call_args.kwargs["prompt_extend"] is False
