from types import SimpleNamespace
from threading import RLock
import tempfile
import wave

import pytest

from src.apps.comic_gen.audio import AudioGenerator, _compute_dialogue_hash, dialogue_audio_is_stale
from src.apps.comic_gen.pipeline import ComicGenPipeline


def test_dialogue_hash_includes_voice_controls():
    base = _compute_dialogue_hash("Line", "voice", "calm", 1.0, 1.0, 50)

    assert _compute_dialogue_hash("Line", "voice", "calm", 1.2, 1.0, 50) != base
    assert _compute_dialogue_hash("Line", "voice", "calm", 1.0, 0.9, 50) != base
    assert _compute_dialogue_hash("Line", "voice", "calm", 1.0, 1.0, 70) != base


def test_dialogue_audio_is_stale_when_character_voice_controls_change():
    character = SimpleNamespace(voice_id="voice", voice_speed=1.0, voice_pitch=1.0, voice_volume=50)
    frame = SimpleNamespace(
        audio_url="audio/line.wav",
        dialogue="Line",
        dialogue_structured=None,
        dialogue_instructions="calm",
        dialogue_text_hash=_compute_dialogue_hash("Line", "voice", "calm", 1.0, 1.0, 50),
    )

    assert dialogue_audio_is_stale(frame, character) is False
    character.voice_speed = 1.2
    assert dialogue_audio_is_stale(frame, character) is True


def test_local_sfx_provider_writes_playable_wav():
    with tempfile.TemporaryDirectory(dir=".") as directory:
        path = f"{directory}/sfx.wav"
        AudioGenerator._write_test_sfx(path, "Door slam", "video/shot.mp4")
        with wave.open(path, "rb") as audio:
            assert audio.getnchannels() == 1
            assert audio.getframerate() == 16_000
            assert audio.getnframes() > 0


@pytest.fixture
def pipeline():
    instance = ComicGenPipeline.__new__(ComicGenPipeline)
    instance.scripts = {}
    instance._save_lock = RLock()
    instance._save_data = lambda: None
    instance.audio_generator = SimpleNamespace(
        generate_sfx_preview=lambda frame, **_: setattr(frame, "preview_sfx_url", "audio/sfx-preview.wav")
    )
    return instance


def test_sfx_preview_apply_and_revert_keep_previous_media(pipeline):
    frame = SimpleNamespace(
        id="frame-1", action_description="Door slam", video_url="video/shot.mp4",
        sfx_url="audio/sfx-old.wav", preview_sfx_url=None,
        sfx_fingerprint="old", preview_sfx_fingerprint=None,
    )
    script = SimpleNamespace(id="script-1", frames=[frame])
    pipeline.scripts[script.id] = script

    pipeline.preview_sfx(script.id, frame.id)
    assert frame.sfx_url == "audio/sfx-old.wav"
    assert frame.preview_sfx_url == "audio/sfx-preview.wav"

    pipeline.apply_sfx(script.id, frame.id)
    assert frame.sfx_url == "audio/sfx-preview.wav"
    assert frame.preview_sfx_url is None

    pipeline.preview_sfx(script.id, frame.id)
    pipeline.revert_sfx(script.id, frame.id)
    assert frame.sfx_url == "audio/sfx-preview.wav"
    assert frame.preview_sfx_url is None


def test_sfx_apply_rejects_preview_when_inputs_changed(pipeline):
    from src.apps.comic_gen.audio import _compute_sfx_fingerprint

    frame = SimpleNamespace(
        id="frame-stale", action_description="Door slam", video_url="video/shot.mp4",
        sfx_url="audio/sfx-old.wav", preview_sfx_url="audio/sfx-preview.wav",
        sfx_fingerprint="old", preview_sfx_fingerprint=_compute_sfx_fingerprint("Door slam", "video/shot.mp4"),
    )
    script = SimpleNamespace(id="script-stale", frames=[frame])
    pipeline.scripts[script.id] = script
    frame.action_description = "Window breaks"
    with pytest.raises(ValueError, match="stale"):
        pipeline.apply_sfx(script.id, frame.id)
