from contextvars import ContextVar


current_workspace_role: ContextVar[str | None] = ContextVar(
    "current_workspace_role",
    default=None,
)


class WorkspacePermissionError(PermissionError):
    pass
