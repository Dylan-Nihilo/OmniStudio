"""Normalize video audio intent across provider-specific parameters."""

from __future__ import annotations

from typing import Any, Dict, Optional


AUDIO_MODES = ("silent", "native", "driven", "post")


def _provider_for_model(model: str) -> str:
    name = (model or "").lower()
    if name.startswith("kling"):
        return "kling"
    if name.startswith("vidu"):
        return "vidu"
    if name.startswith(("seedance", "mulerouter/")):
        return "mulerouter"
    if name.startswith(("minimax", "moma/")):
        return "moma"
    if name.startswith(("wan", "happyhorse", "qwen")):
        return "dashscope"
    return "unknown"


def _legacy_mode(
    *,
    audio_url: Optional[str],
    legacy_generate_audio: bool,
    legacy_sound: Optional[str],
    legacy_vidu_audio: Optional[bool],
) -> str:
    if audio_url:
        return "driven"
    if legacy_generate_audio:
        return "native"
    if (legacy_sound or "").lower() == "on" or legacy_vidu_audio is True:
        return "native"
    return "silent"


def resolve_video_audio_options(
    *,
    model: str,
    audio_mode: Optional[str],
    audio_url: Optional[str],
    legacy_generate_audio: bool = False,
    legacy_sound: Optional[str] = None,
    legacy_vidu_audio: Optional[bool] = None,
) -> Dict[str, Any]:
    """Resolve a task's audio intent into provider-neutral and provider fields.

    The returned mapping is intentionally small and can be passed selectively to
    provider adapters. Legacy callers remain compatible when ``audio_mode`` is
    omitted; explicit modes always take precedence over legacy flags.
    """

    mode = audio_mode or _legacy_mode(
        audio_url=audio_url,
        legacy_generate_audio=legacy_generate_audio,
        legacy_sound=legacy_sound,
        legacy_vidu_audio=legacy_vidu_audio,
    )
    if mode not in AUDIO_MODES:
        raise ValueError(
            f"Unsupported audio_mode '{mode}'. Expected one of: {', '.join(AUDIO_MODES)}"
        )

    provider = _provider_for_model(model)
    if mode == "driven" and not audio_url:
        raise ValueError("audio_url is required when audio_mode is driven")
    if mode == "driven" and provider in {"kling", "vidu", "mulerouter", "unknown"}:
        raise ValueError(f"Provider for model '{model}' does not support driven audio_mode")
    if mode == "native" and provider == "mulerouter":
        raise ValueError(f"Provider for model '{model}' does not support native audio_mode")

    enabled = mode == "native"
    driven_url = audio_url if mode == "driven" else None
    return {
        "mode": mode,
        "audio_url": driven_url,
        "audio": enabled,
        "sound": "on" if enabled else "off",
        "vidu_audio": enabled,
    }
