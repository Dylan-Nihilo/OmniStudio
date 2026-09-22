from __future__ import annotations

from tests.test_source_domain import source_client


def test_source_production_context_includes_episode_mapping_and_portrait_ratio(source_client):
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
    assert body["aspect_ratio"] == "9:16"
    assert body["production_stage"] == "script"
    assert body["stages"] == ["script", "assets", "storyboard", "video", "audio", "assembly", "export"]

