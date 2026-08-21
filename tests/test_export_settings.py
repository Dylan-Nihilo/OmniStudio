from pathlib import Path
from types import SimpleNamespace

import pytest

import src.apps.comic_gen.pipeline as pipeline_module
from src.apps.comic_gen.pipeline import ComicGenPipeline


@pytest.fixture
def merge_harness(tmp_path, monkeypatch):
    """Build the smallest on-disk merge setup while capturing FFmpeg calls."""
    output_root = tmp_path / "output"
    source_path = output_root / "video" / "source.mp4"
    source_path.parent.mkdir(parents=True)
    source_path.write_bytes(b"source")

    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {}
    pipeline._save_data = lambda: None
    pipeline._verify_merged_video = lambda output_path: {"ok": True, "duration": 1.0, "checks": {"has_audio": True}, "video": {}}
    pipeline._maybe_apply_bgm_mux = lambda script, output_path, ffmpeg_path, audio_bitrate="128k": None

    monkeypatch.setattr(pipeline_module, "get_ffmpeg_path", lambda: "ffmpeg")

    def resolve_path(base_dir, relative_path):
        path = tmp_path / base_dir / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        return str(path)

    monkeypatch.setattr(pipeline_module, "_safe_resolve_path", resolve_path)

    commands = []

    def fake_run(command, **kwargs):
        commands.append(command)
        if command[1:2] == ["-version"]:
            return SimpleNamespace(returncode=0, stdout=b"ffmpeg version", stderr=b"")
        # The audio probe succeeds, so merge does not need the normalization
        # branch.  The final command creates the output expected by merge.
        if "concat" in command and command[-1] != "NUL":
            Path(command[-1]).write_bytes(b"merged")
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr(pipeline_module.subprocess, "run", fake_run)

    def install_script(export_settings_marker=...):
        frame = SimpleNamespace(
            id="frame-1",
            dubbed_video_url=None,
            selected_video_id="video-1",
        )
        video = SimpleNamespace(
            id="video-1",
            video_url="video/source.mp4",
            status="completed",
            frame_id="frame-1",
        )
        script = SimpleNamespace(
            id="script-1",
            frames=[frame],
            video_tasks=[video],
            bgm_url=None,
        )
        if export_settings_marker is not ...:
            script.export_settings = export_settings_marker
        pipeline.scripts[script.id] = script
        return script

    return pipeline, install_script, commands


def _final_ffmpeg_command(commands):
    return next(command for command in commands if "concat" in command)


def test_merge_uses_all_export_settings(merge_harness):
    pipeline, install_script, commands = merge_harness
    install_script(
        {
            "resolution": "1920x1080",
            "fps": 24,
            "crf": 18,
            "preset": "slow",
            "audio_bitrate": "256k",
        }
    )

    pipeline.merge_videos("script-1")

    command = _final_ffmpeg_command(commands)
    assert command[command.index("-vf") + 1] == "scale=1920:1080"
    assert command[command.index("-r") + 1] == "24"
    assert command[command.index("-crf") + 1] == "18"
    assert command[command.index("-preset") + 1] == "slow"
    assert command[command.index("-b:a") + 1] == "256k"


def test_merge_uses_only_provided_export_settings(merge_harness):
    pipeline, install_script, commands = merge_harness
    install_script({"resolution": "1280x720", "audio_bitrate": "192k"})

    pipeline.merge_videos("script-1")

    command = _final_ffmpeg_command(commands)
    assert command[command.index("-vf") + 1] == "scale=1280:720"
    assert "-r" not in command
    assert command[command.index("-crf") + 1] == "23"
    assert command[command.index("-preset") + 1] == "fast"
    assert command[command.index("-b:a") + 1] == "192k"


def test_merge_without_export_settings_keeps_existing_defaults(merge_harness):
    pipeline, install_script, commands = merge_harness
    install_script()

    pipeline.merge_videos("script-1")

    command = _final_ffmpeg_command(commands)
    assert command[command.index("-crf") + 1] == "23"
    assert command[command.index("-preset") + 1] == "fast"
    assert command[command.index("-b:a") + 1] == "128k"
    assert "-vf" not in command
    assert "-r" not in command


@pytest.mark.parametrize(
    ("setting", "value"),
    [
        ("resolution", "1920-1080"),
        ("fps", 0),
        ("crf", 29),
        ("preset", "invalid"),
        ("audio_bitrate", "128kbps"),
    ],
)
def test_merge_rejects_invalid_export_settings(merge_harness, setting, value):
    pipeline, install_script, _ = merge_harness
    install_script({setting: value})

    with pytest.raises(ValueError, match=setting):
        pipeline.merge_videos("script-1")



