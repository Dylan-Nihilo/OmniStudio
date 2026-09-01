import os
from contextvars import ContextVar


current_workspace_config: ContextVar[dict[str, str] | None] = ContextVar(
    "current_workspace_config",
    default=None,
)


def workspace_getenv(key: str, default: str | None = None) -> str | None:
    config = current_workspace_config.get()
    if config is None:
        return os.getenv(key, default)
    return config.get(key, default)


def workspace_config_active() -> bool:
    return current_workspace_config.get() is not None
