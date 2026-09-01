import json
from types import SimpleNamespace

import pytest

import src.apps.comic_gen.pipeline as pipeline_module
from src.apps.comic_gen.pipeline import ComicGenPipeline


@pytest.fixture
def pipeline():
    instance = ComicGenPipeline.__new__(ComicGenPipeline)
    instance.scripts = {}
    return instance


def _frame(frame_id="frame-1", selected_video_id="video-1", dubbed_video_url=None):
    return SimpleNamespace(
        id=frame_id,
        selected_video_id=selected_video_id,
        dubbed_video_url=dubbed_video_url,
    )


def _video_task(
    task_id="video-1",
    frame_id="frame-1",
    video_url="video/frame-1.mp4",
    status="completed",
):
    return SimpleNamespace(
        id=task_id,
        frame_id=frame_id,
        video_url=video_url,
        status=status,
    )


def _script(script_id="script-1", frames=None, video_tasks=None):
    return SimpleNamespace(
        id=script_id,
        frames=frames if frames is not None else [_frame()],
        video_tasks=video_tasks if video_tasks is not None else [_video_task()],
    )


def _install_common_mocks(
    monkeypatch,
    duration=3.0,
    free_bytes=10**9,
    file_exists=True,
    readable=True,
    file_size=17,
):
    candidate_path = "output/video_frame-1.mp4"

    def resolve_path(base_dir, relative_path):
        assert base_dir == "output"
        return f"output/{relative_path.replace('/', '_')}"

    monkeypatch.setattr(pipeline_module, "_safe_resolve_path", resolve_path)
    monkeypatch.setattr(pipeline_module, "get_ffprobe_path", lambda: "ffprobe")
    monkeypatch.setattr(
        pipeline_module.shutil,
        "disk_usage",
        lambda path: SimpleNamespace(total=2 * 10**9, used=0, free=free_bytes),
    )
    monkeypatch.setattr(
        pipeline_module.os.path,
        "isfile",
        lambda path: file_exists if path == candidate_path else False,
    )
    monkeypatch.setattr(
        pipeline_module.os.path,
        "getsize",
        lambda path: file_size if path == candidate_path else 0,
    )
    monkeypatch.setattr(
        pipeline_module.os,
        "access",
        lambda path, mode: readable if path == candidate_path else False,
    )

    def fake_run(command, **kwargs):
        assert command[:6] == [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
        ]
        assert kwargs["capture_output"] is True
        assert kwargs["text"] is True
        assert kwargs["encoding"] == "utf-8"
        assert kwargs["errors"] == "replace"
        assert kwargs["timeout"] == 30
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"format": {"duration": str(duration)}}),
            stderr="",
        )

    monkeypatch.setattr(pipeline_module.subprocess, "run", fake_run)
    return candidate_path, file_size


def test_precheck_merge_all_inputs_are_valid(monkeypatch, pipeline):
    candidate_path, file_size = _install_common_mocks(monkeypatch)
    pipeline.scripts["script-1"] = _script()

    report = pipeline.precheck_merge("script-1")

    assert report["ok"] is True
    assert report["script_id"] == "script-1"
    assert report["total_frames"] == 1
    assert report["frames_with_video"] == 1
    assert report["missing"] == []
    assert report["unreadable"] == []
    assert report["duration_anomalies"] == []
    assert report["no_video_available"] == []
    assert report["disk"]["required_bytes"] == int(
        file_size * 1.5 + 50 * 1024 * 1024
    )
    assert report["disk"]["sufficient"] is True
    assert report["errors"] == []


def test_precheck_merge_reports_missing_file(monkeypatch, pipeline):
    candidate_path, _ = _install_common_mocks(monkeypatch, file_exists=False)
    pipeline.scripts["script-1"] = _script()

    report = pipeline.precheck_merge("script-1")

    assert report["ok"] is False
    assert report["frames_with_video"] == 1
    assert report["missing"] == [
        {"frame_id": "frame-1", "expected": "video/frame-1.mp4"}
    ]


def test_precheck_merge_reports_unreadable_file(monkeypatch, pipeline):
    candidate_path, _ = _install_common_mocks(monkeypatch, readable=False)
    pipeline.scripts["script-1"] = _script()

    report = pipeline.precheck_merge("script-1")

    assert report["ok"] is False
    assert report["unreadable"] == [
        {"frame_id": "frame-1", "path": candidate_path}
    ]


def test_precheck_merge_reports_short_duration_without_failing(monkeypatch, pipeline):
    candidate_path, _ = _install_common_mocks(monkeypatch, duration=0.1)
    pipeline.scripts["script-1"] = _script()

    report = pipeline.precheck_merge("script-1")

    assert report["ok"] is True
    assert report["duration_anomalies"] == [
        {
            "frame_id": "frame-1",
            "path": candidate_path,
            "duration": 0.1,
        }
    ]
    assert report["errors"] == []


def test_precheck_merge_reports_frame_without_video(monkeypatch, pipeline):
    _install_common_mocks(monkeypatch)
    pipeline.scripts["script-1"] = _script(video_tasks=[])

    report = pipeline.precheck_merge("script-1")

    assert report["ok"] is False
    assert report["frames_with_video"] == 0
    assert report["no_video_available"] == [
        {
            "frame_id": "frame-1",
            "reason": (
                "Selected video video-1 is unavailable and no completed fallback "
                "video exists"
            ),
        }
    ]


def test_precheck_merge_reports_insufficient_disk_space(monkeypatch, pipeline):
    _install_common_mocks(monkeypatch, free_bytes=1)
    pipeline.scripts["script-1"] = _script()

    report = pipeline.precheck_merge("script-1")

    assert report["ok"] is False
    assert report["disk"]["free_bytes"] == 1
    assert report["disk"]["sufficient"] is False
    assert report["disk"]["required_bytes"] > report["disk"]["free_bytes"]


def test_precheck_merge_reports_missing_script(pipeline):
    report = pipeline.precheck_merge("missing-script")

    assert report["ok"] is False
    assert report["script_id"] == "missing-script"
    assert report["total_frames"] == 0
    assert report["frames_with_video"] == 0
    assert report["errors"] == ["Script not found: missing-script"]
