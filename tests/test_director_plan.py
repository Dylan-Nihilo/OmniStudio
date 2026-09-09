from __future__ import annotations

from tests.test_source_domain import source_client


def _project(source_client):
    client, pipeline = source_client
    project = pipeline.create_project("导演计划验收", "第一镜。", skip_analysis=True)
    workspace_id = client.app.state.auth_service.repository.get_default_workspace(
        client.app.state.auth_service.repository.find_user_by_username("owner").id
    ).id
    pipeline.repository.assign_workspace_for_script(project.id, workspace_id)
    return client, project.id


def test_director_plan_inheritance_override_and_reset(source_client):
    client, project_id = _project(source_client)
    baseline = {
        "tempo": "measured",
        "composition": "symmetrical",
        "lens": "50mm",
        "blocking": "two-shot",
        "lighting": "soft key",
        "transition": "cut",
        "sound": "room tone",
        "continuity_rules": ["match eyeline"],
    }
    response = client.put(f"/director-plans/project/{project_id}", json=baseline)
    assert response.status_code == 200, response.text
    assert response.json()["scope"] == "project"

    episode_override = {"tempo": "urgent", "lighting": "hard backlight"}
    response = client.put(f"/director-plans/episode/{project_id}", json=episode_override)
    assert response.status_code == 200, response.text

    resolved = client.get(f"/director-plans/resolve/{project_id}")
    assert resolved.status_code == 200, resolved.text
    payload = resolved.json()
    assert payload["plan"]["tempo"] == "urgent"
    assert payload["plan"]["composition"] == "symmetrical"
    assert payload["plan"]["lighting"] == "hard backlight"
    assert payload["source_chain"]["tempo"] == "episode"
    assert payload["source_chain"]["composition"] == "project"
    assert "tempo=urgent" in payload["prompt"]
    assert payload["prompt_provenance"]["tempo"] == "episode"

    shot_override = client.put(
        "/director-plans/shot/shot-1",
        json={"lens": "85mm", "transition": "match cut", "episode_id": project_id},
    )
    assert shot_override.status_code == 200, shot_override.text

    resolved_shot = client.get(f"/director-plans/resolve/{project_id}?shot_id=shot-1")
    assert resolved_shot.status_code == 200, resolved_shot.text
    assert resolved_shot.json()["plan"]["lens"] == "85mm"
    assert resolved_shot.json()["source_chain"]["lens"] == "shot"

    deleted = client.delete(f"/director-plans/episode/{project_id}")
    assert deleted.status_code == 200, deleted.text
    after_reset = client.get(f"/director-plans/resolve/{project_id}")
    assert after_reset.json()["plan"]["tempo"] == "measured"
    assert after_reset.json()["source_chain"]["tempo"] == "project"


def test_director_plan_preview_requires_confirmation_before_persisting(source_client):
    client, project_id = _project(source_client)
    preview = client.post(
        f"/director-plans/project/{project_id}/preview",
        json={"instruction": "用低机位和冷色灯光，节奏紧张"},
    )
    assert preview.status_code == 200, preview.text
    preview_payload = preview.json()
    assert preview_payload["status"] == "preview"
    assert preview_payload["preview_id"]

    before_confirm = client.get(f"/director-plans/resolve/{project_id}").json()
    assert before_confirm["plan"]["tempo"] == "balanced"

    confirmed = client.post(
        f"/director-plans/project/{project_id}/confirm",
        json={"preview_id": preview_payload["preview_id"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    after_confirm = client.get(f"/director-plans/resolve/{project_id}").json()
    assert after_confirm["plan"]["tempo"] == "urgent"


def test_director_plan_is_workspace_scoped(source_client):
    client, project_id = _project(source_client)
    client.post("/auth/workspaces", json={"name": "另一个工作区"})
    workspaces = client.get("/auth/workspaces").json()
    other = next(item for item in workspaces if item["id"] != client.app.state.auth_service.repository.get_default_workspace(
        client.app.state.auth_service.repository.find_user_by_username("owner").id
    ).id)
    client.headers.update({"X-Workspace-ID": other["id"]})
    response = client.get(f"/director-plans/resolve/{project_id}")
    assert response.status_code == 404


def test_director_plan_partial_update_returns_merged_payload(source_client):
    client, project_id = _project(source_client)
    first = client.put(
        f"/director-plans/project/{project_id}",
        json={"tempo": "measured", "lens": "50mm"},
    )
    assert first.status_code == 200, first.text
    second = client.put(
        f"/director-plans/project/{project_id}",
        json={"lighting": "hard backlight"},
    )
    assert second.status_code == 200, second.text
    assert second.json()["payload"] == {
        "tempo": "measured",
        "lens": "50mm",
        "lighting": "hard backlight",
    }
