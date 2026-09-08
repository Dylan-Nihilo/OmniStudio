from __future__ import annotations

import hashlib
import io
import zipfile
from unittest.mock import patch

import pytest
import src.apps.comic_gen.api as api_module
from src.apps.comic_gen.auth.service import AuthService
from src.apps.comic_gen.auth.settings import AuthSettings
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.comic_gen.source_models import SourceEpisodeSplitProposal
from src.storage.auth_repository import AuthRepository
from src.storage.source_repository import SourceRepository, SourceRepositoryError
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


def test_source_chapter_list_supports_search_and_pagination(source_client):
    client, _ = source_client
    source = client.post("/sources", json={"title": "分页来源"}).json()
    for number in range(1, 6):
        response = client.post(
            f"/sources/{source['id']}/chapters",
            json={
                "chapter_number": number,
                "title": f"章节 {number}",
                "content": f"正文关键词-{number}",
            },
        )
        assert response.status_code == 201, response.text

    first_page = client.get(
        f"/sources/{source['id']}/chapters",
        params={"page": 1, "page_size": 2},
    )
    assert first_page.status_code == 200, first_page.text
    assert first_page.json()["total"] == 5
    assert first_page.json()["page"] == 1
    assert first_page.json()["page_size"] == 2
    assert [item["chapter_number"] for item in first_page.json()["items"]] == [1, 2]

    second_page = client.get(
        f"/sources/{source['id']}/chapters",
        params={"page": 2, "page_size": 2},
    )
    assert [item["chapter_number"] for item in second_page.json()["items"]] == [3, 4]
    assert client.get(
        f"/sources/{source['id']}/chapters",
        params={"q": "正文关键词-4", "page_size": 10},
    ).json()["items"][0]["chapter_number"] == 4
    assert client.get(
        f"/sources/{source['id']}/chapters",
        params={"search": "章节 5", "page_size": 10},
    ).json()["items"][0]["chapter_number"] == 5
    assert client.get(
        f"/sources/{source['id']}/chapters",
        params={"page": 99, "page_size": 2},
    ).json()["items"] == []

    assert client.get(
        f"/sources/{source['id']}/chapters", params={"page": 0}
    ).status_code == 422
    assert client.get(
        f"/sources/{source['id']}/chapters", params={"page_size": 101}
    ).status_code == 422


def test_source_chapter_edit_appends_and_restores_revisions(source_client):
    client, _ = source_client
    source = client.post("/sources", json={"title": "版本来源"}).json()
    chapter = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 1, "title": "旧标题", "content": "第一版正文"},
    ).json()
    original_revision_id = chapter["current_revision"]["id"]

    renamed = client.patch(
        f"/sources/{source['id']}/chapters/{chapter['id']}",
        json={"title": "新标题"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["title"] == "新标题"
    assert renamed.json()["revision_count"] == 1
    assert renamed.json()["current_revision"]["content"] == "第一版正文"

    edited = client.put(
        f"/sources/{source['id']}/chapters/{chapter['id']}",
        json={"content": "第二版正文"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision_count"] == 2
    assert edited.json()["current_revision"]["revision_number"] == 2
    history = client.get(
        f"/sources/{source['id']}/chapters/{chapter['id']}/revisions"
    ).json()["items"]
    assert [item["revision_number"] for item in history] == [2, 1]

    restored = client.post(
        f"/sources/{source['id']}/chapters/{chapter['id']}/revisions/{original_revision_id}/restore"
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["revision_number"] == 3
    assert restored.json()["metadata"]["edit_type"] == "revision_restore"
    current = client.get(f"/sources/{source['id']}/chapters/{chapter['id']}").json()
    assert current["current_revision"]["content"] == "第一版正文"
    assert current["revision_count"] == 3

    other = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 2, "title": "另一章", "content": "另一章正文"},
    ).json()
    other_revision_id = other["current_revision"]["id"]
    cross_chapter = client.post(
        f"/sources/{source['id']}/chapters/{chapter['id']}/revisions/{other_revision_id}/restore"
    )
    assert cross_chapter.status_code == 404
    assert cross_chapter.json()["error"]["code"] == "SOURCE_REVISION_NOT_FOUND"
    missing = client.post(
        f"/sources/{source['id']}/chapters/{chapter['id']}/revisions/not-found/restore"
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "SOURCE_REVISION_NOT_FOUND"
    assert client.patch(
        f"/sources/{source['id']}/chapters/{chapter['id']}", json={}
    ).status_code == 422


def test_source_episode_links_are_bidirectional_many_to_many_and_idempotent(source_client):
    client, pipeline = source_client
    sources = [
        client.post("/sources", json={"title": "关系来源一"}).json(),
        client.post("/sources", json={"title": "关系来源二"}).json(),
    ]
    projects = [
        pipeline.create_project("关系剧集一", "正文一", skip_analysis=True),
        pipeline.create_project("关系剧集二", "正文二", skip_analysis=True),
    ]
    user = api_module.app.state.auth_service.repository.find_user_by_username("owner")
    workspace_id = api_module.app.state.auth_service.repository.get_default_workspace(user.id).id
    for project in projects:
        pipeline.repository.assign_workspace_for_script(project.id, workspace_id)

    assert client.post(f"/sources/{sources[0]['id']}/episodes/{projects[0].id}").json()["created"] is True
    assert client.post(f"/sources/{sources[0]['id']}/episodes/{projects[1].id}").json()["created"] is True
    assert client.post(f"/sources/{sources[1]['id']}/episodes/{projects[0].id}").json()["created"] is True
    duplicate = client.post(f"/sources/{sources[0]['id']}/episodes/{projects[0].id}")
    assert duplicate.status_code == 201
    assert duplicate.json()["created"] is False

    source_episodes = client.get(f"/sources/{sources[0]['id']}/episodes").json()
    assert {item["id"] for item in source_episodes["items"]} == {projects[0].id, projects[1].id}
    episode_sources = client.get(f"/episodes/{projects[0].id}/sources").json()
    assert {item["id"] for item in episode_sources["items"]} == {sources[0]["id"], sources[1]["id"]}

    unlinked = client.delete(f"/sources/{sources[0]['id']}/episodes/{projects[0].id}")
    assert unlinked.status_code == 200 and unlinked.json()["linked"] is False
    assert client.get(f"/sources/{sources[0]['id']}/episodes").json()["total"] == 1
    assert client.get(f"/episodes/{projects[0].id}/sources").json()["total"] == 1


def test_source_ai_episode_split_is_preview_only_until_confirmation(source_client, monkeypatch):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "AI拆集来源"}).json()
    for number, title, content in (
        (1, "开端", "主角在雨夜收到密信。"),
        (2, "追踪", "她沿着线索追到旧码头。"),
    ):
        created = client.post(
            f"/sources/{source['id']}/chapters",
            json={"chapter_number": number, "title": title, "content": content},
        )
        assert created.status_code == 201, created.text

    proposals = [
        {
            "episode_number": 1,
            "title": "雨夜密信",
            "summary": "主角收到改变命运的密信。",
            "start_marker": "开端",
            "end_marker": "密信。",
            "estimated_duration": "2",
        },
        {
            "episode_number": 2,
            "title": "旧码头追踪",
            "summary": "主角循线索抵达旧码头。",
            "start_marker": "追踪",
            "end_marker": "旧码头。",
            "estimated_duration": "3",
        },
    ]
    monkeypatch.setattr(
        pipeline,
        "import_file_and_split",
        lambda text, suggested: proposals,
    )
    preview_response = client.post(
        f"/sources/{source['id']}/episode-splits/preview",
        json={"suggested_episodes": 2},
    )
    assert preview_response.status_code == 201, preview_response.text
    preview = preview_response.json()
    assert preview["status"] == "previewing"
    assert preview["source_document_id"] == source["id"]
    assert [item["title"] for item in preview["proposals"]] == ["雨夜密信", "旧码头追踪"]
    assert client.get(f"/sources/{source['id']}/episodes").json()["total"] == 0
    assert client.get("/projects").json() == []

    edited = client.patch(
        f"/sources/episode-split-previews/{preview['id']}",
        json={
            "proposals": [
                SourceEpisodeSplitProposal.model_validate(proposals[0]).model_dump(),
                {**proposals[1], "title": "码头追踪"},
            ]
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["proposals"][1]["title"] == "码头追踪"

    confirmed = client.post(
        f"/sources/episode-split-previews/{preview['id']}/confirm",
        json={"title": "AI拆集剧集", "description": "确认后的剧集"},
    )
    assert confirmed.status_code == 200, confirmed.text
    result = confirmed.json()
    assert result["status"] == "confirmed"
    assert len(result["episode_ids"]) == 2
    assert [item["title"] for item in result["episodes"]] == ["雨夜密信", "码头追踪"]
    assert client.get(f"/sources/{source['id']}/episodes").json()["total"] == 2
    assert len(client.get("/projects").json()) == 2

    repeated = client.post(f"/sources/episode-split-previews/{preview['id']}/confirm", json={})
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["episode_ids"] == result["episode_ids"]
    assert repeated.json()["series_id"] == result["series_id"]


def test_source_ai_episode_split_rejects_stale_or_canceled_preview(source_client, monkeypatch):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "拆集状态来源"}).json()
    chapter = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 1, "title": "第一章", "content": "原始正文"},
    ).json()
    proposals = [{
        "episode_number": 1,
        "title": "第一集",
        "summary": "摘要",
        "start_marker": "第一章",
        "end_marker": "正文",
        "estimated_duration": "1",
    }]
    monkeypatch.setattr(pipeline, "import_file_and_split", lambda text, suggested: proposals)

    stale = client.post(f"/sources/{source['id']}/episode-splits/preview", json={}).json()
    edited = client.patch(
        f"/sources/{source['id']}/chapters/{chapter['id']}",
        json={"content": "修改后的正文"},
    )
    assert edited.status_code == 200
    stale_confirm = client.post(
        f"/sources/episode-split-previews/{stale['id']}/confirm", json={}
    )
    assert stale_confirm.status_code == 409
    assert stale_confirm.json()["error"]["code"] == "SOURCE_EPISODE_SPLIT_SOURCE_CHANGED"
    assert client.get(f"/sources/{source['id']}/episodes").json()["total"] == 0
    assert client.get("/projects").json() == []

    canceled = client.post(f"/sources/{source['id']}/episode-splits/preview", json={}).json()
    cancel_response = client.post(
        f"/sources/episode-split-previews/{canceled['id']}/cancel"
    )
    assert cancel_response.status_code == 200
    canceled_confirm = client.post(
        f"/sources/episode-split-previews/{canceled['id']}/confirm", json={}
    )
    assert canceled_confirm.status_code == 409
    assert canceled_confirm.json()["error"]["code"] == "SOURCE_EPISODE_SPLIT_PREVIEW_CANCELED"


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


def test_source_import_preview_supports_txt_encoding_boundary_edit_and_confirm(source_client):
    client, _ = source_client
    text = "第1章 初见\n她推门而入。\n第2章 冲突\n两人对峙。"
    response = client.post(
        "/sources/import/preview",
        files={"file": ("故事.txt", text.encode("gb18030"), "text/plain")},
    )
    assert response.status_code == 201, response.text
    preview = response.json()
    assert preview["original_filename"] == "故事.txt"
    assert preview["encoding"] == "gb18030"
    assert preview["status"] == "previewing"
    assert [item["title"] for item in preview["proposals"]] == ["第1章 初见", "第2章 冲突"]
    assert client.get("/sources").json()["total"] == 0

    corrected = client.patch(
        f"/sources/import/previews/{preview['id']}/boundaries",
        json={
            "proposals": [
                {"start_line": 1, "end_line": 2, "title": "初见"},
                {"start_line": 3, "end_line": 4, "title": "冲突"},
            ]
        },
    )
    assert corrected.status_code == 200, corrected.text
    assert [item["title"] for item in corrected.json()["proposals"]] == ["初见", "冲突"]
    assert client.get("/sources").json()["total"] == 0

    confirmed = client.post(f"/sources/import/previews/{preview['id']}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    source = confirmed.json()["source_document"]
    assert source["original_filename"] == "故事.txt"
    assert source["encoding"] == "gb18030"
    assert source["imported_at"] == source["created_at"]
    assert [item["title"] for item in source["chapters"]] == ["初见", "冲突"]
    assert all(item["current_revision"]["revision_number"] == 1 for item in source["chapters"])
    assert client.get("/sources").json()["total"] == 1

    repeated = client.post(f"/sources/import/previews/{preview['id']}/confirm")
    assert repeated.status_code == 200
    assert repeated.json()["source_document"]["id"] == source["id"]


def test_source_import_supports_paste_docx_and_cancel_state(source_client):
    client, _ = source_client
    pasted = client.post(
        "/sources/import/preview",
        json={"title": "粘贴正文", "source_type": "paste", "content": "无标题正文"},
    )
    assert pasted.status_code == 201, pasted.text
    paste_id = pasted.json()["id"]
    canceled = client.post(f"/sources/import/previews/{paste_id}/cancel")
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"
    assert client.post(f"/sources/import/previews/{paste_id}/confirm").status_code == 409
    assert client.get("/sources").json()["total"] == 0

    document_xml = """<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
    <w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'>
      <w:body><w:p><w:r><w:t>第1章 DOCX</w:t></w:r></w:p>
      <w:p><w:r><w:t>正文来自文档。</w:t></w:r></w:p></w:body>
    </w:document>"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document_xml)
    docx = client.post(
        "/sources/import/preview",
        files={"file": ("文档.docx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert docx.status_code == 201, docx.text
    assert docx.json()["source_type"] == "docx"
    assert docx.json()["proposals"][0]["content"] == "正文来自文档。"


def test_source_import_preview_is_workspace_scoped(source_client):
    client, pipeline = source_client
    preview = client.post(
        "/sources/import/preview",
        json={"title": "隔离", "content": "正文"},
    ).json()
    assert client.get(f"/sources/import/previews/{preview['id']}").status_code == 200

    # The repository still applies the workspace predicate even when an ID is known.
    repository = SourceRepository(pipeline.storage_engine)
    with pytest.raises(SourceRepositoryError) as error:
        repository.get_import_preview("other-workspace", preview["id"])
    assert error.value.code == "SOURCE_IMPORT_PREVIEW_NOT_FOUND"


def test_source_import_rejects_empty_and_unsupported_files(source_client):
    client, _ = source_client
    empty = client.post(
        "/sources/import/preview",
        json={"title": "空", "source_type": "paste", "content": "   "},
    )
    assert empty.status_code == 422
    assert empty.json()["error"]["code"] == "SOURCE_IMPORT_EMPTY"

    unsupported = client.post(
        "/sources/import/preview",
        files={"file": ("story.pdf", b"not a source", "application/pdf")},
    )
    assert unsupported.status_code == 422
    assert unsupported.json()["error"]["code"] == "SOURCE_IMPORT_FILE_TYPE"

    invalid_docx = client.post(
        "/sources/import/preview",
        files={"file": ("story.docx", b"not a zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert invalid_docx.status_code == 422
    assert invalid_docx.json()["error"]["code"] == "SOURCE_IMPORT_DOCX_INVALID"


def test_source_import_recognizes_volume_subtitle():
    from src.apps.comic_gen.source_import import identify_chapters

    proposals = identify_chapters("第一卷：开端\n第1章 初见\n正文")
    assert proposals[0]["volume"] == "第一卷 开端"
