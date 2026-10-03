"""A dubbed episode must not export as a silent film."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from src.apps.comic_gen import api as api_module
from src.apps.comic_gen.models import AudioMode, AudioPolicy, StoryboardFrame, VideoTask
from tests.test_w2_project_api import api_client, _create_project  # noqa: F401

requires_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None,
                                     reason="ffmpeg does the merge; it is a hard requirement in the image")


def _silent_shot(path, seconds=2):
    """A take the way seedance returns one for post-dubbing: video only, no audio track."""
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
                    f"testsrc=size=320x180:rate=15:duration={seconds}", "-an",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)],
                   check=True, capture_output=True, timeout=120)


def _tone(path, seconds=2, hz=440):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
                    f"sine=frequency={hz}:duration={seconds}", str(path)],
                   check=True, capture_output=True, timeout=120)


def _max_volume(path):
    probe = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
                            "-af", "volumedetect", "-f", "null", os.devnull],
                           capture_output=True, text=True, timeout=120)
    for line in probe.stderr.splitlines():
        if "max_volume" in line:
            return float(line.split("max_volume:")[1].replace("dB", "").strip())
    return None


def _episode(client, *, with_dub):
    project = _create_project(client, "配音成片")
    script = api_module.pipeline.scripts[project["id"]]
    Path("output/video").mkdir(parents=True, exist_ok=True)
    Path("output/audio").mkdir(parents=True, exist_ok=True)
    _silent_shot("output/video/shot.mp4")
    if with_dub:
        _tone("output/audio/line.mp3")
    script.frames = [StoryboardFrame(
        id="frame", scene_id="scene", action_description="对峙", duration=2,
        video_url="video/shot.mp4", selected_video_id="take",
        audio_url="audio/line.mp3" if with_dub else None,
    )]
    script.video_tasks = [VideoTask(id="take", project_id=script.id, frame_id="frame", image_url="",
                                    prompt="p", status="completed", video_url="video/shot.mp4")]
    api_module.pipeline._save_data()
    return project["id"]


def _add_silent_audio(path):
    replacement = str(path) + ".audio.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(path), "-f", "lavfi",
                    "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-t", "2", replacement],
                   check=True, capture_output=True, timeout=60)
    os.replace(replacement, path)


@requires_ffmpeg
def test_legacy_dubbing_does_not_depend_on_container_audio_stream(api_client):
    project_id = _episode(api_client, with_dub=True)
    _add_silent_audio("output/video/shot.mp4")
    merged = api_module.pipeline.merge_videos(project_id)
    assert _max_volume(os.path.join("output", merged.merged_video_url)) > -50


@requires_ffmpeg
def test_native_take_never_uses_unapplied_tts(api_client):
    project_id = _episode(api_client, with_dub=True)
    api_module.pipeline.scripts[project_id].video_tasks[0].audio_mode = AudioMode.NATIVE
    api_module.pipeline.scripts[project_id].audio_policy = AudioPolicy(mode="native")
    merged = api_module.pipeline.merge_videos(project_id)
    assert _max_volume(os.path.join("output", merged.merged_video_url)) <= -80


@requires_ffmpeg
def test_silent_policy_also_mutes_selected_bgm(api_client):
    project_id = _episode(api_client, with_dub=False)
    script = api_module.pipeline.scripts[project_id]
    script.video_tasks[0].audio_mode = AudioMode.SILENT
    script.audio_policy = AudioPolicy(mode='silent')
    _tone('output/audio/bgm.wav')
    script.bgm_url = 'audio/bgm.wav'
    merged = api_module.pipeline.merge_videos(project_id)
    assert _max_volume(os.path.join('output', merged.merged_video_url)) <= -80


@requires_ffmpeg
def test_post_dialogue_requires_an_applied_version(api_client):
    project_id = _episode(api_client, with_dub=True)
    script = api_module.pipeline.scripts[project_id]
    script.video_tasks[0].audio_mode = AudioMode.POST
    script.frames[0].dialogue = "This voice has not been applied"
    with pytest.raises(ValueError, match="配音"):
        api_module.pipeline.merge_videos(project_id)


@requires_ffmpeg
def test_a_dubbed_shot_is_audible_in_the_merged_film(api_client, monkeypatch):
    """斗破苍穹 exported 214 seconds of digital silence: the shots came back without audio
    (post-dubbing), the merge substituted `anullsrc` for each one and never read the
    dialogue sitting on the frame.
    """
    monkeypatch.chdir(api_client.app.state.__dict__.get("_test_dir", os.getcwd()))
    project_id = _episode(api_client, with_dub=True)

    merged = api_module.pipeline.merge_videos(project_id)

    path = os.path.join("output", merged.merged_video_url)
    assert os.path.isfile(path), merged.merged_video_url
    level = _max_volume(path)
    assert level is not None, "成片应当有音轨"
    assert level > -50, f"成片仍然是静音（max_volume={level}dB）"


@requires_ffmpeg
def test_a_shot_with_no_dubbing_still_merges_as_silence(api_client, monkeypatch):
    """No dialogue is a legitimate state — it must not fail the export."""
    monkeypatch.chdir(api_client.app.state.__dict__.get("_test_dir", os.getcwd()))
    project_id = _episode(api_client, with_dub=False)

    merged = api_module.pipeline.merge_videos(project_id)
    path = os.path.join("output", merged.merged_video_url)
    assert os.path.isfile(path)
    # Still a well-formed stereo track, just quiet.
    streams = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a",
                              "-show_entries", "stream=channels", "-of", "csv=p=0", path],
                             capture_output=True, text=True, timeout=60).stdout.strip()
    assert streams.startswith("2")
