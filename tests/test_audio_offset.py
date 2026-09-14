from types import SimpleNamespace
import threading

import pytest

from src.apps.comic_gen import pipeline as pipeline_module
from src.apps.comic_gen.models import Character, Script, StoryboardFrame, VideoTask
from src.apps.comic_gen.audio import _compute_dialogue_hash
from src.apps.comic_gen.pipeline import (
    ComicGenPipeline,
    _build_dub_filter,
)


@pytest.mark.parametrize("has_bg", [False, True])
def test_build_dub_filter_delays_positive_offset_with_adelay(has_bg):
    filter_str, delay_note = _build_dub_filter(500, has_bg)

    assert "adelay=500|500" in filter_str
    assert "asetpts" not in filter_str
    assert "延后 500ms" in delay_note
    if has_bg:
        assert "amix=inputs=2:duration=first:weights=1 1" in filter_str
    else:
        assert "[tts]apad[out]" in filter_str


@pytest.mark.parametrize("has_bg", [False, True])
def test_build_dub_filter_leaves_negative_offset_to_mux_stage(has_bg):
    filter_str, delay_note = _build_dub_filter(-500, has_bg)

    assert "asetpts" not in filter_str
    assert "adelay=500" not in filter_str
    assert "adelay=0|0" in filter_str
    assert "提前 500ms（视频流延迟）" in delay_note
    if has_bg:
        assert "amix=inputs=2:duration=first:weights=1 1" in filter_str
    else:
        assert "[tts]apad[out]" in filter_str


def test_build_dub_filter_rejects_offset_outside_supported_range():
    with pytest.raises(ValueError, match=r"-10000.*10000"):
        _build_dub_filter(15000, has_bg=False)


@pytest.mark.parametrize("offset_ms", [500, -500])
@pytest.mark.parametrize("has_bg", [False, True])
def test_preview_dub_builds_expected_ffmpeg_filter(monkeypatch, offset_ms, has_bg):
    video_path = "mock/source.mp4"
    tts_path = "mock/tts.mp3"
    bg_path = "mock/background.wav"

    frame = StoryboardFrame(
        id="frame-1",
        scene_id="scene-1",
        audio_url="audio/tts.mp3",
        preview_video_url=None,
        dubbed_video_task_id=None,
        dub_offset_ms=0,
        dialogue="Dialogue",
        dialogue_text_hash=_compute_dialogue_hash("Dialogue", None, None),
    )
    video_task = VideoTask(id="video-1", project_id="script-1", frame_id=frame.id, status="completed", image_url="", prompt="", model="local", video_url="video/source.mp4")
    script = Script(id="script-1", title="Local", original_text="", created_at=0, updated_at=0, frames=[frame], video_tasks=[video_task])
    pipeline = object.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    pipeline.scripts = {"script-1": script}
    pipeline.resolve_episode_assets = lambda script: {"characters": []}
    pipeline._save_data = lambda: None
    pipeline._resolve_media_path = lambda url, suffix: (
        video_path if suffix == ".mp4" else tts_path
    )
    pipeline._ensure_bg_audio_cached = lambda *args: bg_path if has_bg else None

    monkeypatch.setattr(pipeline_module, "get_ffmpeg_path", lambda: "ffmpeg")
    monkeypatch.setattr(pipeline_module, "get_ffprobe_path", lambda: "ffprobe")
    monkeypatch.setattr(
        pipeline_module,
        "_safe_resolve_path",
        lambda base_dir, relative: f"mock/{relative}",
    )
    monkeypatch.setattr(pipeline_module.os.path, "exists", lambda path: True)
    monkeypatch.setattr(pipeline_module.os.path, "getsize", lambda path: 1500)
    monkeypatch.setattr(pipeline_module.os, "makedirs", lambda *args, **kwargs: None)

    commands = []

    def fake_run(command, **kwargs):
        commands.append(command)
        if command[0] == "ffprobe":
            return SimpleNamespace(returncode=0, stdout="10.0", stderr="")
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr(pipeline_module.subprocess, "run", fake_run)

    result = pipeline.preview_dub(
        "script-1", "frame-1", "video-1", offset_ms=offset_ms
    )

    filter_command = next(command for command in commands if "-filter_complex" in command)
    filter_str = filter_command[filter_command.index("-filter_complex") + 1]
    mux_commands = [
        command
        for command in commands
        if "-i" in command and video_path in command
        and command[command.index("-i") + 1] == video_path
    ]
    mux_command = mux_commands[-1]
    assert "-t" in mux_command

    if offset_ms >= 0:
        assert "adelay=500|500" in filter_str
        assert "asetpts" not in filter_str
        assert "-itsoffset" not in mux_command
    else:
        assert "adelay=500" not in filter_str
        assert "asetpts" not in filter_str
        assert "-itsoffset" in mux_command
        itsoffset_index = mux_command.index("-itsoffset")
        assert mux_command[itsoffset_index + 1] == "0.500000"
        assert mux_command[itsoffset_index + 2 : itsoffset_index + 4] == [
            "-i",
            video_path,
        ]
    assert ("amix=" in filter_str) is has_bg
    assert result is script
    assert frame.preview_offset_ms == offset_ms
    assert frame.dub_offset_ms == 0
    assert frame.preview_video_url.startswith("video/preview_frame-1_")


def test_preview_dub_rejects_out_of_range_offset_before_project_lookup():
    pipeline = object.__new__(ComicGenPipeline)
    pipeline.scripts = {}

    with pytest.raises(ValueError, match=r"-10000.*10000"):
        pipeline.preview_dub("script-1", "frame-1", "video-1", offset_ms=15000)


@pytest.mark.parametrize("status,provider_task_id", [("pending", None), ("processing", "existing-provider-task"), ("processing", None)])
def test_lip_sync_preview_changes_picture_and_retains_review_before_apply(monkeypatch, status, provider_task_id):
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1", audio_url="audio/voice.mp3",
        speaker="Sue", character_ids=["joan", "sue"], dialogue="你好", dialogue_text_hash=_compute_dialogue_hash("你好", None, None))
    task = VideoTask(id="video-1", project_id="script-1", frame_id=frame.id, status="completed",
        image_url="", prompt="", model="minimax/minimax-h3", video_url="video/source.mp4")
    script = Script(id="script-1", title="Local", original_text="", created_at=0, updated_at=0,
        frames=[frame], video_tasks=[task])
    pipeline = object.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    pipeline.scripts = {script.id: script}
    pipeline.resolve_episode_assets = lambda script: {"characters": [Character(id="joan", name="Joan", description=""), Character(id="sue", name="Sue", description="", headshot_image_url="assets/sue.png")]}
    pipeline._save_data = lambda: None
    frame.dub_generation_status = status
    frame.dub_generation_id = "durable-job"
    frame.dub_provider_task_id = provider_task_id
    calls = []
    def render(source, video, offset, on_submitted, face_reference_url):
        assert face_reference_url == "assets/sue.png"
        assert source.dub_provider_task_id == provider_task_id
        calls.append((source.audio_url, video, offset))
        # Web polling refreshes the cached project while the provider runs.
        pipeline.scripts[script.id] = script.model_copy(deep=True)
        on_submitted("provider-task-1")
        return "video/synced.mp4"
    monkeypatch.setattr(pipeline, "_render_lip_sync_preview", render)
    monkeypatch.setattr(pipeline, "_render_dub_preview", lambda *args: pytest.fail("Audio-only replacement cannot repair lip sync"))

    if status == "processing" and provider_task_id is None:
        with pytest.raises(ValueError, match="Interrupted before a provider task ID"):
            pipeline.preview_dub(script.id, frame.id, task.id, offset_ms=600, lip_sync=True, generation_id="durable-job")
        assert calls == []
        return
    pipeline.preview_dub(script.id, frame.id, task.id, offset_ms=600, lip_sync=True, generation_id="durable-job")

    frame = pipeline.scripts[script.id].frames[0]
    assert calls == [("audio/voice.mp3", "video/source.mp4", 600)]
    assert frame.dub_provider_task_id == "provider-task-1"
    assert frame.preview_video_url == "video/synced.mp4"
    assert frame.preview_lip_sync is True
    assert frame.dubbed_video_url is None
