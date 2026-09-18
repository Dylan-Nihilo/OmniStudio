from .workspace_env import workspace_getenv

# Provider endpoint registry: {provider_key: default_base_url}
PROVIDER_DEFAULTS = {
    "DASHSCOPE": "https://dashscope.aliyuncs.com",
    "QWEN_AUDIO_TTS": "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
    "KLING": "https://api-beijing.klingai.com/v1",
    "VIDU": "https://api.vidu.cn/ent/v2",
    "MULEROUTER": "https://api.mulerouter.ai",
    "MOMA": "https://moma.cmecloud.cn/v1",
    # Official main site. Mirror entrances serve the same API under their own domain, e.g.
    # https://jojokey.com/video-api/v1 — point JOJOKEY_BASE_URL at whichever the key belongs to.
    "JOJOKEY": "https://video.jojokey.com/v1",
    # Image relay. Speaks the OpenAI image protocol (and the Gemini native one), so the
    # existing OpenAI-compatible path serves it with only the model name varying per tier.
    "OPEN302": "https://open302.com/v1",
}


def get_provider_base_url(provider: str, default: str = None) -> str:
    """Get base URL for a provider. Convention: reads {PROVIDER}_BASE_URL env var.

    Args:
        provider: Provider key, e.g. "KLING", "DASHSCOPE"
        default: Fallback URL if env var is not set. If None, looks up PROVIDER_DEFAULTS.
    """
    env_key = f"{provider.upper()}_BASE_URL"
    fallback = default or PROVIDER_DEFAULTS.get(provider.upper(), "")
    return (workspace_getenv(env_key) or fallback).rstrip("/")
