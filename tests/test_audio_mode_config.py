import pytest

from src.apps.comic_gen.audio_config import resolve_video_audio_options


def test_legacy_fields_are_derived_when_audio_mode_is_missing():
    assert resolve_video_audio_options(
        model="wan2.6-i2v",
        audio_mode=None,
        audio_url="https://example.test/dialogue.wav",
        legacy_generate_audio=False,
    ) == {
        "mode": "driven",
        "audio_url": "https://example.test/dialogue.wav",
        "audio": False,
        "sound": "off",
        "vidu_audio": False,
    }


def test_silent_disables_wan_native_audio():
    options = resolve_video_audio_options(
        model="wan2.6-i2v",
        audio_mode="silent",
        audio_url=None,
        legacy_generate_audio=True,
    )
    assert options["audio"] is False
    assert options["audio_url"] is None


def test_post_disables_provider_audio_and_native_enables_it():
    post = resolve_video_audio_options(
        model="kling-v2.6-i2v",
        audio_mode="post",
        audio_url=None,
        legacy_generate_audio=False,
    )
    native = resolve_video_audio_options(
        model="kling-v2.6-i2v",
        audio_mode="native",
        audio_url=None,
        legacy_generate_audio=False,
    )
    assert post["sound"] == "off"
    assert native["sound"] == "on"


def test_driven_requires_audio_url():
    with pytest.raises(ValueError, match="audio_url"):
        resolve_video_audio_options(
            model="wan2.6-i2v",
            audio_mode="driven",
            audio_url=None,
            legacy_generate_audio=False,
        )


def test_provider_rejects_unsupported_driven_mode():
    with pytest.raises(ValueError, match="does not support driven"):
        resolve_video_audio_options(
            model="kling-v2.6-i2v",
            audio_mode="driven",
            audio_url="https://example.test/dialogue.wav",
            legacy_generate_audio=False,
        )
