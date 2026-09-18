import os
from contextvars import ContextVar


current_workspace_config: ContextVar[dict[str, str] | None] = ContextVar(
    "current_workspace_config",
    default=None,
)

current_platform_config: ContextVar[dict[str, str] | None] = ContextVar(
    "current_platform_config",
    default=None,
)


def workspace_getenv(key: str, default: str | None = None) -> str | None:
    """Resolve a setting through three layers, most specific first.

    1. the workspace's own override, if it carries the key
    2. the platform layer, which is what the operator configures once for everybody
    3. the process environment, i.e. .env

    The platform layer exists because a hosted deployment holds the credentials centrally:
    configuring them per workspace meant the operator's own settings reached only their own
    workspace, and everybody else silently fell through to whatever was in .env on the
    server. A packaged desktop build never writes that layer and resolves exactly as before.

    Every layer is an override rather than a replacement: a key a layer does not carry falls
    through to the next one. The workspace layer used to answer every lookup once a workspace
    had any config row at all, which meant a single saved setting silently blanked every
    platform credential the workspace had not restated — the reason production read an empty
    OSS bucket while the value sat in .env all along.

    An empty string counts as absent at every layer. Saving a form with a field left blank
    should not shadow the layer below, and clearing a setting deliberately is done by
    blanking it, which is how a removed key falls back to the next layer.
    """
    for config in (current_workspace_config.get(), current_platform_config.get()):
        if config is not None:
            value = config.get(key)
            if value not in (None, ""):
                return value
    return os.getenv(key, default)


def workspace_config_active() -> bool:
    return current_workspace_config.get() is not None
