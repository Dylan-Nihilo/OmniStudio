"""Measured speech must fit before a paid video task is created."""
import pytest

from src.apps.comic_gen import api as api_module
from src.apps.comic_gen.audio import _compute_lines_hash, _compute_dialogue_hash
from src.apps.comic_gen.models import AudioPolicy, Character, DialogueLine, StoryboardFrame, VideoTask
from tests.test_w2_project_api import api_client, _create_project  # noqa: F401


@pytest.fixture(autouse=True)
def no_external_media(api_client, monkeypatch):
    monkeypatch.setattr(api_module.pipeline, "_download_temp_image", lambda url: "output/frame.png")


def _frame(client, *, mode="post", end=7):
    project = _create_project(client, "Dialogue timing")
    pipeline = api_module.pipeline
    script = pipeline.scripts[project["id"]]
    script.audio_policy = AudioPolicy(mode=mode)
    script.characters = [Character(id="actor", name="Actor", description="actor", voice_id="voice")]
    script.frames = [StoryboardFrame(id="f", scene_id="", duration=8,
        audio_url="audio/track.mp3", dialogue_lines=[DialogueLine(
            speaker="Actor", line="Hello", start_seconds=4, scheduled_start_seconds=4,
            duration=end - 4, audio_url="audio/line.mp3", voice_id="voice")])]
    frame = script.frames[0]
    plans = pipeline._dialogue_line_plans(script, frame, None, None, 1, 1, 50, None)
    frame.dialogue_text_hash = _compute_lines_hash(plans)
    pipeline._save_data()
    return script, frame


def _submit(client, script, *, duration=5, mode="post"):
    return client.post(f"/projects/{script.id}/video_tasks", json={
        "image_url": "https://example.test/frame.png", "prompt": "a scene",
        "frame_id": "f", "duration": duration, "model": "wan2.6-i2v",
        "audio_mode": mode,
    })


def test_post_video_rejects_measured_speech_past_requested_duration(api_client):
    script, frame = _frame(api_client)
    response = _submit(api_client, script, duration=5)
    assert response.status_code == 400, response.text
    assert "7.0" in response.json()["detail"] and "5.0" in response.json()["detail"]
    assert not api_module.pipeline.scripts[script.id].video_tasks
    assert frame.duration == 8, "preflight must not mutate the storyboard"


def test_post_video_rejects_stale_measured_track(api_client):
    script, frame = _frame(api_client)
    frame.dialogue_lines[0].line = "An entirely different line"
    api_module.pipeline._save_data()
    response = _submit(api_client, script, duration=8)
    assert response.status_code == 400, response.text
    assert not api_module.pipeline.scripts[script.id].video_tasks


def test_post_video_requires_measurement_before_generating_a_take(api_client):
    script, frame = _frame(api_client)
    frame.audio_url = None
    api_module.pipeline._save_data()
    response = _submit(api_client, script, duration=8)
    assert response.status_code == 400, response.text
    assert "实测" in response.json()["detail"]
    assert not api_module.pipeline.scripts[script.id].video_tasks


def test_post_video_without_dialogue_does_not_require_tts(api_client):
    script, frame = _frame(api_client)
    frame.audio_url = None
    frame.dialogue_lines = []
    frame.dialogue = ""
    api_module.pipeline._save_data()
    assert _submit(api_client, script, duration=8).status_code == 200


def test_retry_of_a_short_post_take_cannot_bypass_timing_validation(api_client):
    script, frame = _frame(api_client)
    script.video_tasks = [VideoTask(id="failed-take", project_id=script.id, frame_id=frame.id,
        image_url="https://example.test/frame.png", prompt="a scene", model="wan2.6-i2v",
        status="failed", audio_mode="post", duration=5)]
    api_module.pipeline._save_data()
    response = api_client.post(f"/projects/{script.id}/video_tasks/failed-take/retry")
    assert response.status_code == 400, response.text
    assert len(api_module.pipeline.scripts[script.id].video_tasks) == 1


@pytest.mark.parametrize("mode", ["silent", "native"])
def test_other_audio_modes_do_not_reuse_old_on_screen_tts_timing(api_client, mode):
    script, frame = _frame(api_client, mode=mode)
    frame.dialogue_lines[0].line = "Changed words"
    api_module.pipeline._save_data()
    response = _submit(api_client, script, duration=5, mode=mode)
    assert response.status_code == 200, response.text


def test_adjacent_measured_lines_fit_without_overlap(api_client):
    script, frame = _frame(api_client, end=8)
    frame.dialogue_lines.insert(0, DialogueLine(speaker="Actor", line="First", start_seconds=0,
        scheduled_start_seconds=0, duration=4, audio_url="audio/first.mp3", voice_id="voice"))
    frame.dialogue_text_hash = _compute_lines_hash(api_module.pipeline._dialogue_line_plans(
        script, frame, None, None, 1, 1, 50, None))
    assert api_module.pipeline._validate_video_dialogue_timing(script, frame, 8, "post") is None


def test_native_to_post_switch_checks_all_current_words(api_client):
    script, frame = _frame(api_client, mode="native")
    frame.dialogue_lines[0].line = "Changed native words"
    api_module.pipeline._save_data()
    response = _submit(api_client, script, duration=8, mode="post")
    assert response.status_code == 400, response.text
    assert not api_module.pipeline.scripts[script.id].video_tasks


@pytest.mark.parametrize("duration", [None, 0])
def test_measured_track_with_missing_or_invalid_line_duration_is_not_approved(api_client, duration):
    script, frame = _frame(api_client)
    frame.dialogue_lines[0].duration = duration
    api_module.pipeline._save_data()
    response = _submit(api_client, script, duration=8)
    assert response.status_code == 400, response.text
    assert not api_module.pipeline.scripts[script.id].video_tasks


def test_nonfinite_measurement_cannot_pass_preflight(api_client):
    script, frame = _frame(api_client)
    frame.dialogue_lines[0].duration = float("nan")
    with pytest.raises(ValueError, match="时长"):
        api_module.pipeline._validate_video_dialogue_timing(script, frame, 8, "post")


@pytest.mark.parametrize("missing", [False, True])
def test_legacy_single_track_is_measured_before_video_generation(api_client, monkeypatch, missing):
    script, frame = _frame(api_client)
    frame.dialogue_lines = []
    frame.dialogue = "Hello"
    frame.dialogue_voice_id = "voice"
    frame.dialogue_text_hash = _compute_dialogue_hash("Hello", "voice", None)
    def measure(url):
        if missing:
            raise OSError("missing track")
        return (0, 7)
    monkeypatch.setattr("src.apps.comic_gen.pipeline._dialogue_audio_bounds", measure)
    api_module.pipeline._save_data()
    response = _submit(api_client, script, duration=5)
    assert response.status_code == 400, response.text
    assert not api_module.pipeline.scripts[script.id].video_tasks


@pytest.mark.parametrize("first_duration,blocked,media_duration", [(4, False, 8), (5, True, 8), (4, True, 5)])
@pytest.mark.parametrize("mode", ["post", "native"])
def test_export_blocks_overlapping_applied_dialogue(api_client, monkeypatch, first_duration, blocked, media_duration, mode):
    from tests.test_merge_precheck import _install_common_mocks
    _install_common_mocks(monkeypatch, duration=media_duration)
    monkeypatch.setattr("src.apps.comic_gen.pipeline._dialogue_audio_bounds", lambda url: (0, 8))
    script, frame = _frame(api_client, end=8, mode=mode)
    frame.dialogue_lines.insert(0, DialogueLine(speaker="Actor", line="First", start_seconds=0,
        scheduled_start_seconds=0, duration=first_duration, audio_url="audio/first.mp3", voice_id="voice"))
    pipeline = api_module.pipeline
    if mode == "native":
        for line in frame.dialogue_lines:
            line.mode = "voiceover"
    frame.dialogue_text_hash = _compute_lines_hash(pipeline._dialogue_line_plans(
        script, frame, None, None, 1, 1, 50, None))
    if mode == "native":
        frame.dialogue_lines.insert(0, DialogueLine(speaker="Actor", line="Model-owned speech"))
    frame.selected_video_id = "take"
    frame.dubbed_video_task_id = "take"
    frame.dubbed_video_url = "video/frame-1.mp4"
    frame.dubbed_audio_url = frame.audio_url
    frame.dubbed_audio_policy = script.audio_policy
    script.video_tasks = [VideoTask(id="take", project_id=script.id, frame_id=frame.id,
        image_url="", prompt="a scene", status="completed", video_url="video/frame-1.mp4",
        audio_mode=mode, visual_input_fingerprint=pipeline._shot_input_fingerprint(script, frame, audio_inputs=False),
        native_audio_input_fingerprint=pipeline._shot_input_fingerprint(script, frame, audio_inputs=False, native_inputs=True)
            if mode == "native" else None)]
    report = pipeline.precheck_merge(script.id)
    assert report["ok"] is not blocked, report
    if blocked:
        reason = "重叠" if first_duration == 5 else "截断"
        assert any(issue["blocking"] and reason in issue["reason"] for issue in report["content_issues"])
