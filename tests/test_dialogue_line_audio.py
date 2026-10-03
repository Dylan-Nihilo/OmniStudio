"""Per-speaker dialogue: each line in its own voice, placed at its own shot."""
import os
import shutil
import subprocess

import pytest

from src.apps.comic_gen.audio import (
    AudioGenerator, _assemble_dialogue_track, _audio_duration, _compute_lines_hash,
    dialogue_audio_is_stale,
)
from src.apps.comic_gen.models import DialogueLine, GenerationStatus, StoryboardFrame


def _tone(path, seconds, hz=440):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
                    f"sine=frequency={hz}:duration={seconds}", str(path)],
                   check=True, capture_output=True, timeout=60)
    return str(path)


requires_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None,
                                     reason="ffmpeg assembles the track; it is a hard requirement in the image")


@requires_ffmpeg
def test_assembled_track_preserves_speech_past_the_shot_end(tmp_path):
    source = _tone(tmp_path / "long.wav", 2)
    output = str(tmp_path / "track.wav")
    _assemble_dialogue_track([(source, 0.5)], output, 1)
    assert _audio_duration(output) >= 2.49


@requires_ffmpeg
def test_lines_are_laid_out_at_their_offsets_and_cannot_stretch_the_segment(tmp_path):
    """Back-to-back playback would put a voice over the wrong shot.

    斗破苍穹 片段3 runs three shots at 9 / 10 / 8 seconds; a line written for the third
    shot has to be heard at 19s, not at 4s because two short lines came first.
    """
    clips = [(_tone(tmp_path / "a.mp3", 2, 300), 0.0),
             (_tone(tmp_path / "b.mp3", 2, 600), 9.0),
             (_tone(tmp_path / "c.mp3", 2, 900), 19.0)]
    track = tmp_path / "track.mp3"
    _assemble_dialogue_track(clips, str(track), 27.0)

    assert abs(_audio_duration(str(track)) - 27.0) < 0.2, "the track is pinned to the segment"

    # Where the audible regions actually are, read back off the rendered track.
    probe = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(track), "-af",
         "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
         "-f", "null", "-"], capture_output=True, text=True, timeout=120).stdout
    levels = [float(line.split("=")[1]) for line in probe.splitlines() if "RMS_level" in line]
    assert levels, probe
    fps = len(levels) / _audio_duration(str(track))
    audible = [index / fps for index, value in enumerate(levels) if value > -50]
    starts = [audible[0]]
    for previous, current in zip(audible, audible[1:]):
        if current - previous > 1.0:            # a gap means the next line
            starts.append(current)
    assert len(starts) == 3, starts
    for found, expected in zip(starts, (0.0, 9.0, 19.0)):
        assert abs(found - expected) < 0.4, (starts, expected)


@requires_ffmpeg
def test_an_overlong_line_is_reported_and_never_trimmed(tmp_path, monkeypatch):
    """Shortening a line is a creative decision, so it is flagged rather than cut."""
    frame = StoryboardFrame(id="frame", scene_id="scene", duration=8, dialogue_lines=[
        DialogueLine(speaker="陆青", line="很长的一句", start_seconds=0.0),
        DialogueLine(speaker="沈砚", line="短句", start_seconds=4.0),
    ])
    generator = AudioGenerator({})
    monkeypatch.chdir(tmp_path)
    (tmp_path / "output").mkdir()
    generator.output_dir = str(tmp_path / "output")

    lengths = iter([6.0, 1.0])              # first line overruns its 4-second window

    class _Tts:
        def synthesize(self, text, path, **kwargs):
            _tone(path, next(lengths))

    generator.tts = _Tts()
    plans = [{"line": frame.dialogue_lines[0], "voice": "v1", "window": 4.0},
             {"line": frame.dialogue_lines[1], "voice": "v2", "window": 4.0}]
    generator.generate_dialogue_lines(frame, plans, total_duration=8.0)

    assert frame.status == GenerationStatus.COMPLETED, frame.audio_error
    assert frame.dialogue_lines[0].overruns_shot is True
    assert frame.dialogue_lines[1].overruns_shot is False
    # Flagged, not cut: the clip keeps its full length.
    assert frame.dialogue_lines[0].duration > 5.5
    assert frame.dialogue_lines[0].voice_id == "v1" and frame.dialogue_lines[1].voice_id == "v2"
    assert os.path.isfile(os.path.join("output", frame.audio_url))


def test_reassigning_one_characters_voice_makes_the_whole_track_stale():
    """The track is assembled from every line, so any line going stale stales the track."""
    lines = [DialogueLine(speaker="陆青", line="第一句", start_seconds=0.0),
             DialogueLine(speaker="沈砚", line="第二句", start_seconds=4.0)]
    frame = StoryboardFrame(id="frame", scene_id="scene", duration=8, dialogue_lines=lines,
                            audio_url="dialogue/track.mp3")
    plans = [{"line": lines[0], "voice": "voice-lu"}, {"line": lines[1], "voice": "voice-shen"}]
    frame.dialogue_text_hash = _compute_lines_hash(plans)
    assert not dialogue_audio_is_stale(frame, None, plans)

    reassigned = [{"line": lines[0], "voice": "voice-lu"}, {"line": lines[1], "voice": "voice-other"}]
    assert dialogue_audio_is_stale(frame, None, reassigned)

    edited = [{"line": lines[0].model_copy(update={"line": "改过的第一句"}), "voice": "voice-lu"},
              {"line": lines[1], "voice": "voice-shen"}]
    assert dialogue_audio_is_stale(frame, None, edited)

    # Without freshly resolved voices there is nothing to compare, so it is not called current.
    assert dialogue_audio_is_stale(frame, None, None)
