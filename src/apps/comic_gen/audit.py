"""Workspace-scoped audit events with defensive metadata redaction."""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import dataclass
from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.engine import Engine

from ...storage.schema import AuditEvent


_SENSITIVE_KEY_PARTS = (
    "api_key",
    "apikey",
    "token",
    "secret",
    "password",
    "credential",
    "authorization",
)
_WINDOWS_ABSOLUTE = re.compile(r"^[A-Za-z]:[\\/]")


@dataclass(frozen=True)
class AuditEventRecord:
    id: str
    actor_user_id: str | None
    workspace_id: str
    action: str
    object_type: str
    object_id: str
    metadata: dict[str, Any]
    created_at: float


def _is_absolute_path(value: str) -> bool:
    return os.path.isabs(value) or bool(_WINDOWS_ABSOLUTE.match(value))


def sanitize_metadata(value: Any, *, key: str = "") -> Any:
    """Redact credential-like keys and absolute local paths recursively."""
    key_normalized = key.casefold().replace("-", "_")
    if any(part in key_normalized for part in _SENSITIVE_KEY_PARTS):
        return "[REDACTED]"
    if isinstance(value, str):
        return "[REDACTED_PATH]" if _is_absolute_path(value) else value
    if isinstance(value, Mapping):
        return {str(child_key): sanitize_metadata(child, key=str(child_key)) for child_key, child in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [sanitize_metadata(child, key=key) for child in value]
    return value


def _record_from_row(row: Mapping[str, Any]) -> AuditEventRecord:
    return AuditEventRecord(
        id=str(row["id"]),
        actor_user_id=str(row["actor_user_id"]) if row["actor_user_id"] else None,
        workspace_id=str(row["workspace_id"]),
        action=str(row["action"]),
        object_type=str(row["object_type"]),
        object_id=str(row["object_id"]),
        metadata=json.loads(row["metadata_json"]),
        created_at=float(row["created_at"]),
    )


def record(
    *,
    engine: Engine,
    actor_user_id: str | None,
    workspace_id: str,
    action: str,
    object_type: str,
    object_id: str,
    metadata: Mapping[str, Any] | None = None,
    created_at: float | None = None,
) -> AuditEventRecord:
    """Persist one redacted audit event and return its stable record."""
    event_id = str(uuid.uuid4())
    timestamp = time.time() if created_at is None else float(created_at)
    safe_metadata = sanitize_metadata(dict(metadata or {}))
    with engine.begin() as connection:
        connection.execute(
            AuditEvent.__table__.insert().values(
                id=event_id,
                actor_user_id=actor_user_id,
                workspace_id=workspace_id,
                action=action,
                object_type=object_type,
                object_id=object_id,
                metadata_json=json.dumps(safe_metadata, ensure_ascii=False, sort_keys=True),
                created_at=timestamp,
            )
        )
    return AuditEventRecord(
        id=event_id,
        actor_user_id=actor_user_id,
        workspace_id=workspace_id,
        action=action,
        object_type=object_type,
        object_id=object_id,
        metadata=safe_metadata,
        created_at=timestamp,
    )


def list_events(*, engine: Engine, workspace_id: str, limit: int = 100) -> list[AuditEventRecord]:
    bounded_limit = max(1, min(int(limit), 500))
    with engine.connect() as connection:
        rows = connection.execute(
            select(AuditEvent.__table__)
            .where(AuditEvent.workspace_id == workspace_id)
            .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
            .limit(bounded_limit)
        ).mappings().all()
    return [_record_from_row(row) for row in rows]


def record_request_event(
    request: Any,
    *,
    action: str,
    object_type: str,
    object_id: str,
    metadata: Mapping[str, Any] | None = None,
) -> AuditEventRecord | None:
    """Best-effort route helper; never exposes secrets or breaks the request."""
    app = getattr(request, "app", None)
    engine = getattr(getattr(app, "state", None), "storage_engine", None)
    context = getattr(getattr(request, "state", None), "auth_context", None)
    workspace = getattr(context, "workspace", None)
    workspace_id = getattr(workspace, "id", None)
    if engine is None or not workspace_id:
        return None
    try:
        return record(
            engine=engine,
            actor_user_id=getattr(getattr(context, "user", None), "id", None),
            workspace_id=str(workspace_id),
            action=action,
            object_type=object_type,
            object_id=object_id,
            metadata=metadata,
        )
    except Exception:
        return None


__all__ = ["AuditEventRecord", "list_events", "record", "record_request_event", "sanitize_metadata"]
