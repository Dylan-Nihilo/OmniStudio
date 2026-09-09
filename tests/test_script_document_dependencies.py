from __future__ import annotations

from tests.test_source_domain import source_client


def test_script_document_persists_source_dependency_and_becomes_stale_after_revision(source_client):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "Script 上游来源"}).json()
    chapter = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 1, "title": "第一章", "content": "初始正文"},
    ).json()

    project = pipeline.create_project("Script 依赖剧集", "初始正文", skip_analysis=True)
    user = client.app.state.auth_service.repository.find_user_by_username("owner")
    workspace_id = client.app.state.auth_service.repository.get_default_workspace(user.id).id
    pipeline.repository.assign_workspace_for_script(project.id, workspace_id)
    linked = client.post(f"/sources/{source['id']}/episodes/{project.id}")
    assert linked.status_code == 201, linked.text

    content = {"type": "doc", "content": [{"type": "action", "content": [{"type": "text", "text": "脚本正文"}]}]}
    saved = client.post(f"/projects/{project.id}/document", json={"content": content})
    assert saved.status_code == 200, saved.text
    saved_payload = saved.json()
    assert saved_payload["revision"]
    assert len(saved_payload["dependency_fingerprint"]) == 64
    assert saved_payload["stale"] is False
    assert saved_payload["source_dependencies"] == [
        {
            "source_id": source["id"],
            "source_title": "Script 上游来源",
            "chapter_id": chapter["id"],
            "chapter_title": "第一章",
            "revision_id": chapter["current_revision"]["id"],
            "revision_number": 1,
        }
    ]
    assert saved_payload["dependency_graph"] == {
        "sources": [{"source_id": source["id"], "chapter_id": chapter["id"], "revision_id": chapter["current_revision"]["id"]}],
        "targets": [],
    }

    loaded = client.get(f"/projects/{project.id}/document")
    assert loaded.status_code == 200, loaded.text
    assert loaded.json()["content"] == content
    assert loaded.json()["stale"] is False

    changed = client.put(
        f"/sources/{source['id']}/chapters/{chapter['id']}",
        json={"content": "更新后的正文"},
    )
    assert changed.status_code == 200, changed.text

    stale = client.get(f"/projects/{project.id}/document")
    assert stale.status_code == 200, stale.text
    stale_payload = stale.json()
    assert stale_payload["stale"] is True
    assert stale_payload["source_dependencies"][0]["revision_number"] == 2
    assert stale_payload["stale_targets"]
    assert any(target["target_type"] == "script" for target in stale_payload["stale_targets"])


def test_script_dependency_fingerprint_changes_after_source_revision_restore(source_client):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "Fingerprint 来源"}).json()
    chapter = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 1, "title": "第一章", "content": "版本一"},
    ).json()
    project = pipeline.create_project("Fingerprint 剧集", "正文", skip_analysis=True)
    user = client.app.state.auth_service.repository.find_user_by_username("owner")
    workspace_id = client.app.state.auth_service.repository.get_default_workspace(user.id).id
    pipeline.repository.assign_workspace_for_script(project.id, workspace_id)
    assert client.post(f"/sources/{source['id']}/episodes/{project.id}").status_code == 201
    content = {"type": "doc", "content": [{"type": "action", "content": [{"type": "text", "text": "脚本"}]}]}
    saved = client.post(f"/projects/{project.id}/document", json={"content": content}).json()
    original_fingerprint = saved["dependency_fingerprint"]

    changed = client.put(f"/sources/{source['id']}/chapters/{chapter['id']}", json={"content": "版本二"})
    assert changed.status_code == 200
    current = client.get(f"/sources/{source['id']}/chapters/{chapter['id']}/revisions").json()["items"]
    first_revision = next(item for item in current if item["revision_number"] == 1)
    restored = client.post(
        f"/sources/{source['id']}/chapters/{chapter['id']}/revisions/{first_revision['id']}/restore"
    )
    assert restored.status_code == 200

    after_restore = client.get(f"/projects/{project.id}/document").json()
    assert after_restore["dependency_fingerprint"] != original_fingerprint
    assert after_restore["source_dependencies"][0]["revision_number"] == 3
    assert after_restore["stale"] is True
