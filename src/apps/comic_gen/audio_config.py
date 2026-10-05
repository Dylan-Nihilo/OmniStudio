"""Normalize video audio intent across provider-specific parameters."""

from __future__ import annotations

from typing import Any, Dict, Optional


AUDIO_MODES = ("silent", "native", "driven", "post")


def video_audio_capabilities(model: str, backend: Optional[str] = None) -> Dict[str, Any]:
    from ...utils.model_catalog import get_catalog_accessor
    from ...utils.provider_registry import resolve_provider_backend
    accessor = get_catalog_accessor()
    canonical = accessor.resolve_legacy_to_canonical(model) or model
    entry = accessor.get_mode_entry(canonical) or {}
    if backend is None:
        try:
            backend = resolve_provider_backend(model)
        except (KeyError, ValueError):
            backend = entry.get("default_backend", "unknown")
    runtime = entry.get("runtime", {}).get(backend, {})
    modes = runtime.get("audio_modes", ["post", "silent"])
    return {"backend": backend, "modes": modes,
            "input_kind": runtime.get("audio_input_kind"),
            "can_disable_native": runtime.get("can_disable_native", False)}


def effective_audio_policy(script, frame=None):
    from .models import AudioPolicy
    policy = getattr(frame, "audio_policy_override", None) or getattr(script, "audio_policy", None)
    if policy:
        return policy
    legacy = getattr(frame, "omni_reference_settings", None)
    return AudioPolicy(mode=legacy.audio_mode, audio_url=legacy.audios[0].url if legacy.audios else None) if legacy else AudioPolicy()


def dialogue_frame_for_policy(script, frame):
    """Project only independent narration when the model owns the on-screen speech."""
    mode = effective_audio_policy(script, frame).mode
    source = frame.model_copy(deep=True)
    if mode == "silent":
        source.dialogue_lines = []
        source.dialogue = ""
        source.dialogue_structured = None
    elif mode == "native":
        source.dialogue_lines = [line for line in source.dialogue_lines if line.mode == "voiceover"]
        if frame.dialogue_lines or frame.dialogue_mode != "voiceover":
            source.dialogue = ""
            source.dialogue_structured = None
        source.dialogue_mode = "voiceover"
    return source


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
    backend: Optional[str] = None,
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

    capabilities = video_audio_capabilities(model, backend)
    provider = capabilities["backend"]
    if mode == "driven" and not audio_url:
        raise ValueError("audio_url is required when audio_mode is driven")
    if audio_mode is not None and mode not in capabilities["modes"]:
        raise ValueError(f"Model '{model}' does not support {mode} audio_mode on the selected backend")
    if mode == "driven" and provider in {"vendor", "mulerouter", "unknown"}:
        raise ValueError(f"Provider for model '{model}' does not support driven audio_mode")
    if mode == "native" and provider == "mulerouter":
        raise ValueError(f"Provider for model '{model}' does not support native audio_mode")

    if mode == "driven" and provider == "jojokey" and model.startswith("seedance"):
        from .omni_reference import public_https
        if not public_https(audio_url or ""):
            raise ValueError("当前声音参考需要可公开访问的 HTTPS 音频地址")

    enabled = mode == "native" or (mode == "driven" and provider == "jojokey")
    driven_url = audio_url if mode == "driven" else None
    return {
        "mode": mode,
        "audio_url": driven_url,
        "audio": enabled,
        "sound": "on" if enabled else "off",
        "vidu_audio": enabled,
    }
