from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from src.apps.comic_gen.models import Script, StoryboardFrame, VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.utils.system_check import get_ffmpeg_path, get_ffprobe_path


FFMPEG = get_ffmpeg_path() or shutil.which("ffmpeg")
FFPROBE = get_ffprobe_path() or shutil.which("ffprobe")
pytestmark = pytest.mark.skipif(not FFMPEG or not FFPROBE, reason="ffmpeg and ffprobe are required")


def _generate_clip(path: Path, color: str, duration: int = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            str(FFMPEG),
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s=96x64:r=30:d={duration}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:sample_rate=48000:duration={duration}",
            "-shortest",
            "-c:v",
            "libx264",
            "-g",
            "1",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(path),
        ],
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")


def _probe(path: Path) -> dict:
    result = subprocess.run(
        [
            str(FFPROBE),
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            str(path),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _pipeline(script: Script) -> ComicGenPipeline:
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline._save_data = lambda: None
    return pipeline


def _task(task_id: str, frame_id: str, relative_path: str, duration: int) -> VideoTask:
    return VideoTask(
        id=task_id,
        project_id="ffprobe-project",
        frame_id=frame_id,
        image_url="storyboard/source.png",
        prompt="acceptance clip",
        status="completed",
        video_url=relative_path,
        duration=duration,
    )


def test_real_merge_applies_trim_video_audio_fps_and_soft_subtitles(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    source = Path("output/video/source.mp4")
    _generate_clip(source, "red")
    frame = StoryboardFrame(
        id="frame-1",
        scene_id="scene-1",
        action_description="Red frame",
        dialogue="真实导出验收",
        selected_video_id="take-1",
        duration=2,
        in_point=0.2,
        out_point=1.1,
    )
    script = Script(
        id="ffprobe-project",
        title="FFprobe acceptance",
        original_text="test",
        frames=[frame],
        video_tasks=[_task("take-1", frame.id, "video/source.mp4", 2)],
        export_settings={
            "resolution": "160x120",
            "fps": 24,
            "crf": 20,
            "preset": "fast",
            "audio_bitrate": "96k",
            "subtitles": "soft",
        },
        created_at=0,
        updated_at=0,
    )

    result = _pipeline(script).merge_videos(script.id)

    output = Path("output") / str(result.merged_video_url)
    probe = _probe(output)
    video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in probe["streams"] if stream["codec_type"] == "audio")
    subtitle = next(stream for stream in probe["streams"] if stream["codec_type"] == "subtitle")
    numerator, denominator = video["avg_frame_rate"].split("/", 1)

    assert (video["width"], video["height"]) == (160, 120)
    assert float(numerator) / float(denominator) == pytest.approx(24, abs=0.01)
    assert video["codec_name"] == "h264"
    assert audio["codec_name"] == "aac"
    assert subtitle["codec_name"] == "mov_text"
    assert 0.75 <= float(video["duration"]) <= 1.05
    assert result.merge_verification["ok"] is True
    assert result.merge_verification["checks"]["has_audio"] is True
    assert result.merge_verification["checks"]["has_subtitles"] is True


def test_real_merge_applies_crossfade_transition(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _generate_clip(Path("output/video/red.mp4"), "red", duration=2)
    _generate_clip(Path("output/video/blue.mp4"), "blue", duration=2)
    first = StoryboardFrame(
        id="frame-1",
        scene_id="scene-1",
        action_description="Red",
        selected_video_id="take-1",
        duration=2,
        transition_hint="fade",
    )
    second = StoryboardFrame(
        id="frame-2",
        scene_id="scene-2",
        action_description="Blue",
        selected_video_id="take-2",
        duration=2,
    )
    script = Script(
        id="ffprobe-project",
        title="Transition acceptance",
        original_text="test",
        frames=[first, second],
        video_tasks=[
            _task("take-1", first.id, "video/red.mp4", 2),
            _task("take-2", second.id, "video/blue.mp4", 2),
        ],
        export_settings={"resolution": "160x120", "fps": 24, "audio_bitrate": "96k"},
        created_at=0,
        updated_at=0,
    )

    result = _pipeline(script).merge_videos(script.id)

    output = Path("output") / str(result.merged_video_url)
    probe = _probe(output)
    video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in probe["streams"] if stream["codec_type"] == "audio")
    assert 3.5 <= float(video["duration"]) <= 3.8
    assert audio["codec_name"] == "aac"
    assert result.merge_verification["ok"] is True
    assert not os.path.exists(f"output/merge_list_{script.id}.txt")
