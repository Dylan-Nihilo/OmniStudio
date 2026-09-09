from src.apps.comic_gen.storyboard_readiness import evaluate_storyboard_readiness
from src.apps.comic_gen.models import Character, Scene, Script, StoryboardFrame
from tests.test_w2_project_api import api_client


def test_readiness_reports_missing_scene_and_character_references():
    script = Script(
        id="script-1",
        title="Readiness",
        original_text="text",
        scenes=[Scene(id="scene-1", name="Dock", description="A dock")],
        characters=[Character(id="char-1", name="A", description="Hero")],
        frames=[StoryboardFrame(id="frame-1", scene_id="missing", character_ids=["char-missing"], action_description="Run")],
        created_at=0,
        updated_at=0,
    )

    report = evaluate_storyboard_readiness(script)

    assert report["ready"] is False
    assert {item["code"] for item in report["blockers"]} == {"SCENE_NOT_FOUND", "CHARACTER_NOT_FOUND"}


def test_readiness_detects_match_cut_across_different_scenes_and_persists_api_result(api_client):
    project = api_client.post("/projects?skip_analysis=true", json={"title": "Readiness API", "text": "text"}).json()
    route = f"/projects/{project['id']}"
    first = api_client.post(route + "/frames", json={"scene_id": "scene-a", "action_description": "One"}).json()["frames"][0]
    second = api_client.post(route + "/frames", json={"scene_id": "scene-b", "action_description": "Two"}).json()["frames"][1]
    api_client.post(route + "/frames/update", json={"frame_id": first["id"], "scene_id": "scene-a", "transition_hint": "match_cut"})
    api_client.post(route + "/frames/update", json={"frame_id": second["id"], "scene_id": "scene-b"})

    response = api_client.get(route + "/storyboard/readiness")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ready"] is False
    assert any(item["code"] == "MATCH_CUT_SCENE_CONFLICT" for item in body["blockers"])
    persisted = api_client.get(route).json()
    assert persisted["storyboard_ready"] is False
    assert persisted["storyboard_readiness"]["blockers"]
