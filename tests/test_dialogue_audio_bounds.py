import math
import struct
import wave

import pytest

from src.apps.comic_gen.pipeline import _dialogue_audio_bounds
from src.utils.system_check import get_ffmpeg_path, get_ffprobe_path


@pytest.mark.skipif(not get_ffmpeg_path() or not get_ffprobe_path(), reason="FFmpeg is required")
def test_dialogue_bounds_handle_unicode_media_paths(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    relative_path = "audio/万象配音.wav"
    path = tmp_path / "output" / relative_path
    path.parent.mkdir(parents=True)
    rate = 16000
    samples = [
        int(16000 * math.sin(2 * math.pi * 440 * i / rate))
        if 0.2 <= i / rate < 0.7 else 0
        for i in range(rate)
    ]
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(struct.pack(f"<{len(samples)}h", *samples))

    start, end = _dialogue_audio_bounds(relative_path)

    assert start == pytest.approx(0.2, abs=0.02)
    assert end == pytest.approx(0.7, abs=0.02)
