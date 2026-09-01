import subprocess
import tempfile
from types import SimpleNamespace

import pytest

import src.apps.comic_gen.pipeline as pipeline_module
from src.apps.comic_gen.models import Script, StoryboardFrame, VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline


@pytest.fixture
def pipeline():
    instance = ComicGenPipeline.__new__(ComicGenPipeline)
    instance.scripts = {}
    instance._save_data = lambda: None
    return instance


def _script(script_id="script-1"):
    frame = StoryboardFrame(
        id="frame-1",
        scene_id="scene-1",
        selected_video_id="video-1",
    )
    video_task = VideoTask(
        id="video-1",
        project_id=script_id,
        frame_id=frame.id,
        image_url="image/frame-1.png",
        prompt="test prompt",
        status="completed",
        video_url="video/frame-1.mp4",
    )
    return Script(
        id=script_id,
        title="Merge progress test",
        original_text="test",
        created_at=1.0,
        updated_at=1.0,
        frames=[frame],
        video_tasks=[video_task],
    )


def _install_merge_mocks(monkeypatch, tmp_path, *, fail_concat=False):
    input_path = tmp_path / "video" / "frame-1.mp4"
    input_path.parent.mkdir(parents=True)
    input_path.write_bytes(b"input video")

    def fake_safe_resolve_path(base_dir, relative_path):
        base = str(base_dir).replace("\\", "/")
        if base == "output":
            return str(tmp_path / relative_path)
        if base == "output/video":
            return str(tmp_path / "video" / relative_path)
        raise AssertionError(f"Unexpected base path: {base_dir}")

    normalization_dir = tmp_path / "normalization"

    def fake_mkdtemp(*, prefix):
        assert prefix == "omni_studio_merge_script-1_"
        normalization_dir.mkdir()
        return str(normalization_dir)

    def fake_run(command, **kwargs):
        if command[1:] == ["-version"]:
            return SimpleNamespace(
                returncode=0,
                stdout="ffmpeg version test\n",
                stderr="",
            )

        if "-frames:a" in command:
            return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

        if "concat" in command:
            if fail_concat:
                raise subprocess.CalledProcessError(
                    returncode=1,
                    cmd=command,
                    output=b"concat failed",
                    stderr=b"mock concat failure",
                )
            output_path = command[-1]
            with open(output_path, "wb") as output_file:
                output_file.write(b"merged video")
            return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

        raise AssertionError(f"Unexpected subprocess command: {command}")

    monkeypatch.setattr(pipeline_module, "_safe_resolve_path", fake_safe_resolve_path)
    monkeypatch.setattr(pipeline_module, "get_ffmpeg_path", lambda: "ffmpeg")
    monkeypatch.setattr(tempfile, "mkdtemp", fake_mkdtemp)
    monkeypatch.setattr(pipeline_module.subprocess, "run", fake_run)


def test_set_merge_progress_updates_script_in_memory(monkeypatch, pipeline):
    script = _script()
    pipeline.scripts[script.id] = script
    monkeypatch.setattr(pipeline_module.time, "time", lambda: 123.45)

    pipeline._set_merge_progress(script, "preparing", "准备导出", 0.05)

    assert pipeline.scripts[script.id].merge_progress == {
        "stage": "preparing",
        "message": "准备导出",
        "progress": 0.05,
        "updated_at": 123.45,
    }


def test_merge_videos_sets_done_progress(monkeypatch, tmp_path, pipeline):
    script = _script()
    pipeline.scripts[script.id] = script
    _install_merge_mocks(monkeypatch, tmp_path)
    monkeypatch.setattr(pipeline, "_maybe_apply_bgm_mux", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        pipeline,
        "_verify_merged_video",
        lambda output_path: {
            "ok": True,
            "duration": 1.0,
            "video": {"codec": "h264"},
            "audio": None,
            "checks": {"has_audio": False},
            "errors": [],
        },
    )

    observed_stages = []
    original_set_progress = pipeline._set_merge_progress

    def record_progress(script_obj, stage, message, progress):
        observed_stages.append(stage)
        original_set_progress(script_obj, stage, message, progress)

    monkeypatch.setattr(pipeline, "_set_merge_progress", record_progress)

    result = pipeline.merge_videos(script.id)

    assert result is script
    assert observed_stages == [
        "preparing",
        "collecting",
        "normalizing",
        "transcoding",
        "writing",
        "mixing",
        "verifying",
        "done",
    ]
    assert script.merge_progress["stage"] == "done"
    assert script.merge_progress["message"] == "导出完成"
    assert script.merge_progress["progress"] == 1.0
    assert script.merged_video_url.startswith("video/merged_script-1_")
    assert script.merged_video_url.endswith(".mp4")


def test_merge_videos_sets_failed_progress_on_ffmpeg_error(
    monkeypatch, tmp_path, pipeline
):
    script = _script()
    pipeline.scripts[script.id] = script
    _install_merge_mocks(monkeypatch, tmp_path, fail_concat=True)

    with pytest.raises(RuntimeError):
        pipeline.merge_videos(script.id)

    assert script.merge_progress["stage"] == "failed"
    assert script.merge_progress["progress"] == 0.0
    assert script.merge_progress["message"]
