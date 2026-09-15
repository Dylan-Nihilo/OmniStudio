import os
from contextvars import ContextVar


current_workspace_config: ContextVar[dict[str, str] | None] = ContextVar(
    "current_workspace_config",
    default=None,
)


def workspace_getenv(key: str, default: str | None = None) -> str | None:
    """Resolve a setting, letting a workspace override the platform's own configuration.

    The workspace config is an override layer, not a replacement: a key it does not carry
    falls through to the process environment. It used to answer every lookup once a
    workspace had any config row at all, which meant a single saved setting silently
    blanked every platform credential the workspace had not restated — the reason
    production read an empty OSS bucket while the value sat in .env all along.

    An empty string counts as absent. Saving a form with a field left blank should not
    shadow a platform value; clearing a setting deliberately is done by removing the key.
    """
    config = current_workspace_config.get()
    if config is not None:
        value = config.get(key)
        if value not in (None, ""):
            return value
    return os.getenv(key, default)


def workspace_config_active() -> bool:
    return current_workspace_config.get() is not None
