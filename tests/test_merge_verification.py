import json
from types import SimpleNamespace

import pytest

import src.apps.comic_gen.pipeline as pipeline_module
from src.apps.comic_gen.pipeline import ComicGenPipeline


@pytest.fixture
def pipeline():
    return ComicGenPipeline.__new__(ComicGenPipeline)


def _probe_payload(include_audio=True):
    streams = [
        {
            "codec_type": "video",
            "codec_name": "h264",
            "width": 1920,
            "height": 1080,
            "avg_frame_rate": "30/1",
            "duration": "3.5",
        },
    ]
    if include_audio:
        streams.append(
            {
                "codec_type": "audio",
                "codec_name": "aac",
                "sample_rate": "48000",
                "channels": 2,
                "duration": "3.5",
            }
        )
    return {"streams": streams, "format": {"duration": "3.5"}}


def _install_ffprobe_mock(monkeypatch, payload):
    monkeypatch.setattr(pipeline_module, "get_ffprobe_path", lambda: "ffprobe")

    def fake_run(command, **kwargs):
        assert command[:7] == [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
        ]
        assert kwargs["capture_output"] is True
        assert kwargs["text"] is True
        assert kwargs["encoding"] == "utf-8"
        assert kwargs["errors"] == "replace"
        return SimpleNamespace(returncode=0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr(pipeline_module.subprocess, "run", fake_run)


def test_verify_merged_video_passes_with_video_and_audio(tmp_path, monkeypatch, pipeline):
    output_path = tmp_path / "merged.mp4"
    output_path.write_bytes(b"not a real video; ffprobe is mocked")
    _install_ffprobe_mock(monkeypatch, _probe_payload(include_audio=True))

    report = pipeline._verify_merged_video(str(output_path))

    assert report["ok"] is True
    assert report["video"] == {
        "codec": "h264",
        "width": 1920,
        "height": 1080,
        "fps": 30.0,
        "duration": 3.5,
    }
    assert report["audio"] == {
        "codec": "aac",
        "sample_rate": 48000,
        "channels": 2,
    }
    assert report["duration"] == 3.5
    assert report["checks"] == {
        "has_video": True,
        "has_audio": True,
        "duration_valid": True,
        "resolution_valid": True,
    }
    assert report["errors"] == []


def test_verify_merged_video_allows_missing_audio(tmp_path, monkeypatch, pipeline):
    output_path = tmp_path / "silent.mp4"
    output_path.write_bytes(b"not a real video; ffprobe is mocked")
    _install_ffprobe_mock(monkeypatch, _probe_payload(include_audio=False))

    report = pipeline._verify_merged_video(str(output_path))

    assert report["ok"] is True
    assert report["audio"] is None
    assert report["checks"]["has_audio"] is False
    assert report["errors"] == []


def test_verify_merged_video_reports_missing_ffprobe(tmp_path, monkeypatch, pipeline):
    output_path = tmp_path / "merged.mp4"
    output_path.write_bytes(b"not a real video")
    monkeypatch.setattr(pipeline_module, "get_ffprobe_path", lambda: None)

    report = pipeline._verify_merged_video(str(output_path))

    assert report["ok"] is False
    assert report["errors"]
    assert "ffprobe" in report["errors"][0].lower()


def test_verify_merged_video_reports_missing_output(tmp_path, monkeypatch, pipeline):
    output_path = tmp_path / "missing.mp4"
    monkeypatch.setattr(pipeline_module, "get_ffprobe_path", lambda: "ffprobe")

    report = pipeline._verify_merged_video(str(output_path))

    assert report["ok"] is False
    assert any("not found" in error.lower() for error in report["errors"])
