from __future__ import annotations

from tests.test_source_domain import source_client


def test_imported_source_series_uses_canonical_vertical_r2v_defaults(source_client):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "竖屏生产来源"}).json()
    preview = client.post(
        f"/sources/{source['id']}/episode-splits/preview",
        json={"suggested_episodes": 1},
    )
    # The source has no body yet, so create a chapter and use the split API's
    # normal source input in the follow-up assertion below.
    assert preview.status_code in {422, 503}

    result = pipeline.create_series_from_import(
        "竖屏系列",
        "第一集：林默走进雨夜。",
        [{"episode_number": 1, "title": "第一集", "start_marker": "第一集", "end_marker": "。"}],
        workflow_mode="r2v",
        aspect_ratio="9:16",
    )
    series = pipeline.get_series(result["series"]["id"])
    episode = pipeline.get_script(result["episodes"][0]["id"])
    assert series.workflow_mode == "r2v"
    assert series.model_settings.storyboard_aspect_ratio == "9:16"
    assert pipeline.resolve_model_settings(episode.id).settings.storyboard_aspect_ratio == "9:16"


def test_source_production_context_uses_parent_series_and_shared_assets(source_client):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "共享资产来源"}).json()
    chapter = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 1, "title": "第一章", "content": "林默走进雨夜。"},
    ).json()
    result = pipeline.create_series_from_import(
        "系列",
        "林默走进雨夜。",
        [{"episode_number": 1, "title": "第一集", "start_marker": "林默", "end_marker": "。"}],
        workflow_mode="r2v",
        aspect_ratio="9:16",
    )
    episode_id = result["episodes"][0]["id"]
    user = client.app.state.auth_service.repository.find_user_by_username("owner")
    workspace_id = client.app.state.auth_service.repository.get_default_workspace(user.id).id
    pipeline.repository.assign_workspace_for_series(result["series"]["id"], workspace_id)
    pipeline.repository.assign_workspace_for_script(episode_id, workspace_id)
    assert client.post(f"/sources/{source['id']}/episodes/{episode_id}").status_code == 201

    response = client.get(f"/episodes/{episode_id}/production-context")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["project_id"] == result["series"]["id"]
    assert body["aspect_ratio"] == "9:16"
    assert body["counts"]["characters"] == 0
    assert body["production_stage"] == "assets"


def test_source_production_context_reports_effective_ratio(source_client):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "生产上下文来源"}).json()
    chapter = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 1, "title": "第一章", "content": "林默走进雨夜。"},
    ).json()
    episode = pipeline.create_project("EP.01 雨夜", "林默走进雨夜。", skip_analysis=True)
    user = client.app.state.auth_service.repository.find_user_by_username("owner")
    workspace_id = client.app.state.auth_service.repository.get_default_workspace(user.id).id
    pipeline.repository.assign_workspace_for_script(episode.id, workspace_id)
    linked = client.post(f"/sources/{source['id']}/episodes/{episode.id}")
    assert linked.status_code == 201, linked.text

    response = client.get(f"/episodes/{episode.id}/production-context")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["episode_id"] == episode.id
    assert body["source_dependencies"] == [
        {
            "source_id": source["id"],
            "source_title": "生产上下文来源",
            "chapter_id": chapter["id"],
            "chapter_title": "第一章",
            "revision_id": chapter["current_revision"]["id"],
            "revision_number": 1,
        }
    ]
    # Existing standalone projects keep their effective workspace setting.
    # Source imports opt into portrait mode explicitly (covered above).
    assert body["aspect_ratio"] == "16:9"
    assert body["production_stage"] == "assets"
    assert body["stages"] == ["script", "assets", "storyboard", "video", "audio", "assembly", "export"]


def test_source_production_context_reads_explicit_chapter_relation_without_document_link(source_client):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "章节级来源"}).json()
    chapter = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 1, "title": "第一章", "content": "章节正文"},
    ).json()
    episode = pipeline.create_project("第一集", "章节正文", skip_analysis=True)
    user = client.app.state.auth_service.repository.find_user_by_username("owner")
    workspace_id = client.app.state.auth_service.repository.get_default_workspace(user.id).id
    pipeline.repository.assign_workspace_for_script(episode.id, workspace_id)
    linked = client.post(f"/sources/{source['id']}/chapters/{chapter['id']}/episodes/{episode.id}")
    assert linked.status_code == 201, linked.text

    response = client.get(f"/episodes/{episode.id}/production-context")
    assert response.status_code == 200, response.text
    assert [item["chapter_id"] for item in response.json()["source_dependencies"]] == [chapter["id"]]


def test_source_production_context_does_not_mix_chapters_when_one_source_has_explicit_links(source_client):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "多集章节来源"}).json()
    chapters = [client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": number, "title": title, "content": content},
    ).json() for number, title, content in ((1, "第一章", "第一章正文"), (2, "第二章", "第二章正文"))]
    first = pipeline.create_project("第一集", "第一章正文", skip_analysis=True)
    second = pipeline.create_project("第二集", "第二章正文", skip_analysis=True)
    user = client.app.state.auth_service.repository.find_user_by_username("owner")
    workspace_id = client.app.state.auth_service.repository.get_default_workspace(user.id).id
    for episode in (first, second):
        pipeline.repository.assign_workspace_for_script(episode.id, workspace_id)
        assert client.post(f"/sources/{source['id']}/episodes/{episode.id}").status_code == 201
    assert client.post(f"/sources/{source['id']}/chapters/{chapters[0]['id']}/episodes/{first.id}").status_code == 201
    assert client.post(f"/sources/{source['id']}/chapters/{chapters[1]['id']}/episodes/{second.id}").status_code == 201

    first_dependencies = client.get(f"/episodes/{first.id}/production-context").json()["source_dependencies"]
    assert [item["chapter_id"] for item in first_dependencies] == [chapters[0]["id"]]
