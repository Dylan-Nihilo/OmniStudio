from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
import threading

from src.apps.comic_gen.models import Script, StoryboardFrame, VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.utils.system_check import get_ffmpeg_path, get_ffprobe_path


FFMPEG = get_ffmpeg_path() or shutil.which("ffmpeg")
FFPROBE = get_ffprobe_path() or shutil.which("ffprobe")
pytestmark = pytest.mark.skipif(not FFMPEG or not FFPROBE, reason="ffmpeg and ffprobe are required")


def _generate_clip(path: Path, color: str, duration: float = 2, *, sample_rate: int = 48000, fps: int = 30) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            str(FFMPEG),
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s=96x64:r={fps}:d={duration}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:sample_rate={sample_rate}:duration={duration}",
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
    pipeline._save_lock = threading.RLock()
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


def test_cut_merge_preserves_fractional_second_frame_counts(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    frames, tasks, expected = [], [], []
    for index, (color, count) in enumerate(zip(("red", "green", "blue"), (158, 175, 124))):
        path = Path(f"output/video/{color}.mp4")
        _generate_clip(path, color, count / 24, sample_rate=32000, fps=24)
        frame = StoryboardFrame(id=f"frame-{index}", scene_id="scene", action_description=color,
            selected_video_id=f"take-{index}", duration=7, in_point=0, out_point=count / 24,
            transition_hint="cut")
        frames.append(frame)
        tasks.append(_task(frame.selected_video_id, frame.id, f"video/{color}.mp4", 7))
        expected.extend([index] * count)
    script = Script(id="ffprobe-project", title="Exact cuts", original_text="test", frames=frames,
        video_tasks=tasks, export_settings={"fps": 24, "preset": "fast"}, created_at=0, updated_at=0)
    result = _pipeline(script).merge_videos(script.id)
    output = Path("output", result.merged_video_url)
    raw = subprocess.check_output([str(FFMPEG), "-v", "error", "-i", str(output),
        "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-fps_mode", "passthrough", "-f", "rawvideo", "-"])
    colors = [max(range(3), key=lambda channel: raw[offset + channel]) for offset in range(0, len(raw), 3)]
    assert colors == expected
    audio = next(stream for stream in _probe(output)["streams"] if stream["codec_type"] == "audio")
    assert abs(float(audio["duration"]) - len(expected) / 24) < 1 / 24


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


def test_export_captions_follow_spoken_audio_offsets_trims_and_crossfades(tmp_path, monkeypatch):
    """Captions follow the applied voice, including edits to the final timeline."""
    import math
    import struct
    import wave

    monkeypatch.chdir(tmp_path)
    voice = Path("output/audio/line.wav")
    voice.parent.mkdir(parents=True)
    with wave.open(str(voice), "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(i * 2 * math.pi * 440 / 16000))
            if 3200 <= i < 16000 else 0) for i in range(24000)))
    frames, tasks = [], []
    for i, offset in enumerate((400, 200)):
        rel = f"video/clip-{i}.mp4"
        _generate_clip(Path("output") / rel, "red", 2)
        frames.append(StoryboardFrame(id=f"frame-{i}", scene_id="scene", duration=2,
            dialogue=f"Line {i + 1}", audio_url="audio/line.wav", dub_offset_ms=offset,
            selected_video_id=f"take-{i}", dubbed_video_task_id=f"take-{i}", dubbed_video_url=rel,
            in_point=0.2 if i == 0 else 0, out_point=1.7 if i == 0 else None,
            transition_hint="fade" if i == 0 else None))
        tasks.append(_task(f"take-{i}", f"frame-{i}", rel, 2))
    script = Script(id="ffprobe-project", title="Caption timing", original_text="test",
        frames=frames, video_tasks=tasks, export_settings={"subtitles": "soft", "fps": 24},
        created_at=0, updated_at=0)

    result = _pipeline(script).merge_videos(script.id)

    captions = subprocess.check_output([str(FFMPEG), "-v", "error", "-i",
        str(Path("output") / result.merged_video_url), "-map", "0:s:0", "-f", "srt", "-"], text=True)
    assert "00:00:00,400 --> 00:00:01,200" in captions
    assert "00:00:01,550 --> 00:00:02,350" in captions


@pytest.mark.parametrize("transition", ["硬切", "叠化"])
def test_real_merge_fits_mixed_provider_tracks_to_shot_timeline(tmp_path, monkeypatch, transition):
    monkeypatch.chdir(tmp_path)
    frames, tasks = [], []
    for i, (rate, fps, duration) in enumerate([(24000, 24, 2.6), (44100, 30, 1.6), (32000, 24, 2.2)]):
        relative = f"video/source-{i}.mp4"
        _generate_clip(Path("output") / relative, ["red", "green", "blue"][i], duration, sample_rate=rate, fps=fps)
        frame = StoryboardFrame(id=f"frame-{i}", scene_id="scene", action_description="test",
                                selected_video_id=f"take-{i}", duration=2,
                                transition_hint="硬切" if i == 0 else transition)
        frames.append(frame)
        tasks.append(_task(f"take-{i}", frame.id, relative, 2))
    script = Script(id="ffprobe-project", title="Mixed provider tracks", original_text="test",
                    frames=frames, video_tasks=tasks, export_settings={"resolution": "160x120", "fps": 24},
                    created_at=0, updated_at=0)
    result = _pipeline(script).merge_videos(script.id)
    output = Path("output") / result.merged_video_url
    streams = _probe(output)["streams"]
    durations = [float(s["duration"]) for s in streams if s["codec_type"] in {"video", "audio"}]
    expected = 6 if transition == "硬切" else 5.65
    assert all(abs(d - expected) < 0.12 for d in durations)
    assert abs(durations[0] - durations[1]) < 0.08
    decoded = subprocess.run([str(FFMPEG), "-v", "error", "-i", str(output), "-f", "null", "-"], capture_output=True)
    assert decoded.returncode == 0 and not decoded.stderr
