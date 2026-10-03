"""Audio intent survives reloads without changing sibling shots or old takes."""

from src.apps.comic_gen import api as api_module
from src.apps.comic_gen.models import AudioPolicy, StoryboardFrame, VideoTask
from src.apps.comic_gen.audio_render import resolve_shot_audio_render_spec
from src.apps.comic_gen.audio_config import dialogue_frame_for_policy
from tests.test_w2_project_api import api_client, _create_project  # noqa: F401


def test_project_default_and_sparse_shot_override_persist(api_client):
    project = _create_project(api_client, "Audio policy")
    route = f"/projects/{project['id']}"
    script = api_module.pipeline.scripts[project["id"]]
    script.frames = [StoryboardFrame(id="a", scene_id="s"), StoryboardFrame(id="b", scene_id="s")]
    api_module.pipeline._save_data()
    response = api_client.put(route + "/audio_policy", json={"mode": "native"})
    assert response.status_code == 200, response.text
    response = api_client.put(route + "/frames/a/audio_policy", json={"policy": {"mode": "post"}})
    assert response.status_code == 200, response.text
    saved = api_client.get(route).json()
    assert saved["audio_policy"]["mode"] == "native"
    assert saved["frames"][0]["audio_policy_override"]["mode"] == "post"
    assert saved["frames"][1]["audio_policy_override"] is None
    response = api_client.put(route + "/frames/a/audio_policy", json={"policy": None})
    assert response.status_code == 200, response.text
    assert api_client.get(route).json()["frames"][0]["audio_policy_override"] is None


def test_invalid_audio_policy_does_not_mutate_project(api_client):
    project = _create_project(api_client, "Policy validation")
    route = f"/projects/{project['id']}"
    response = api_client.put(route + "/audio_policy", json={"mode": "not-a-mode"})
    assert response.status_code == 422
    assert api_client.get(route).json()["audio_policy"]["mode"] == "post"


def test_audio_capabilities_are_available_to_the_ui(api_client):
    response = api_client.get('/config/video-audio-capabilities')
    assert response.status_code == 200, response.text
    assert response.json()['wan2.6-i2v']['input_kind'] == 'timing'
    assert 'native' not in response.json()['wan2.2-i2v-plus']['modes']


def test_switching_native_take_to_post_requires_confirmed_dub():
    frame = StoryboardFrame(id="a", scene_id="s", dialogue="hello")
    task = VideoTask(id="t", project_id="p", image_url="", prompt="", audio_mode="native")
    import pytest
    with pytest.raises(ValueError, match="配音"):
        resolve_shot_audio_render_spec(frame, task, AudioPolicy(mode="post"))


def test_applied_dub_becomes_stale_when_voice_or_policy_changes():
    frame = StoryboardFrame(id="a", scene_id="s", audio_url="audio/new.wav",
        dubbed_video_url="video/dub.mp4", dubbed_video_task_id="t",
        dubbed_audio_url="audio/old.wav", dubbed_audio_policy=AudioPolicy())
    task = VideoTask(id="t", project_id="p", image_url="", prompt="", audio_mode="post")
    import pytest
    with pytest.raises(ValueError, match="配音"):
        resolve_shot_audio_render_spec(frame, task, AudioPolicy())


def test_native_candidate_cannot_be_relabelled_as_audio_driven():
    frame = StoryboardFrame(id="a", scene_id="s")
    task = VideoTask(id="t", project_id="p", image_url="", prompt="", audio_mode="native")
    import pytest
    with pytest.raises(ValueError, match="重新生成"):
        resolve_shot_audio_render_spec(frame, task, AudioPolicy(mode="driven"))


def test_native_speech_projection_keeps_only_independent_voiceover():
    from src.apps.comic_gen.models import Script, DialogueLine
    frame = StoryboardFrame(id='f', scene_id='s', dialogue_lines=[
        DialogueLine(speaker='A', line='native words'),
        DialogueLine(speaker='Narrator', line='independent words', mode='voiceover', start_seconds=1)])
    script = Script(id='p', title='p', original_text='', created_at=0, updated_at=0, audio_policy=AudioPolicy(mode='native'))
    projected = dialogue_frame_for_policy(script, frame)
    assert [line.line for line in projected.dialogue_lines] == ['independent words']
    assert len(frame.dialogue_lines) == 2
    assert projected.dialogue_lines[0].start_seconds == 1
