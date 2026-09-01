"""Transactional ownership claim workflow for validated legacy Studio data."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse

from sqlalchemy import select, update
from sqlalchemy.engine import Engine

from .db import begin_immediate
from .errors import LegacyDataError, MigrationError
from .migration import preview as preview_legacy
from .schema import LegacyClaimBatch, Project


class LegacyClaimError(Exception):
    def __init__(self, code: str, message: str, *, status_code: int = 409) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


_MEDIA_SUFFIXES = {
    ".aac",
    ".flac",
    ".gif",
    ".jpeg",
    ".jpg",
    ".m4a",
    ".mov",
    ".mp3",
    ".mp4",
    ".ogg",
    ".png",
    ".wav",
    ".webm",
    ".webp",
}


def _iter_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for child in value.values():
            yield from _iter_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_strings(child)


def _is_media_reference(value: str) -> bool:
    normalized = value.strip().replace("\\", "/")
    if not normalized:
        return False
    path = urlparse(normalized).path if "://" in normalized else normalized
    return path.startswith(("/files/", "files/", "output/", "/output/")) or Path(path).suffix.lower() in _MEDIA_SUFFIXES


def _media_count(source_files: list[dict[str, Any]]) -> int:
    references: set[str] = set()
    for item in source_files:
        path_value = item.get("path")
        if not item.get("exists") or not path_value:
            continue
        try:
            payload = json.loads(Path(str(path_value)).read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        references.update(value for value in _iter_strings(payload) if _is_media_reference(value))
    return len(references)


def _batch_payload(row: Any) -> dict[str, Any]:
    mapping = json.loads(row["mapping_json"])
    return {
        "id": row["id"],
        "source_sha256": row["source_sha256"],
        "status": row["status"],
        "project_ids": list(mapping.get("project_ids", [])),
        "series_ids": list(mapping.get("series_ids", [])),
        "created_at": row["created_at"],
        "completed_at": row["completed_at"],
        "rolled_back_at": row["rolled_back_at"],
    }


def _batch_summary(row: Any) -> dict[str, int]:
    return {
        "projects": int(row["project_count"]),
        "series": int(row["series_count"]),
        "media": int(row["media_count"]),
        "conflicts": int(row["conflict_count"]),
    }


class LegacyClaimService:
    def __init__(
        self,
        engine: Engine,
        *,
        db_path: str | Path,
        projects_path: str | Path,
        series_path: str | Path | None,
    ) -> None:
        self.engine = engine
        self.db_path = Path(db_path)
        self.projects_path = Path(projects_path)
        self.series_path = Path(series_path) if series_path is not None else None

    def _latest_batch(self, user_id: str, workspace_id: str):
        with self.engine.connect() as connection:
            return connection.execute(
                select(LegacyClaimBatch.__table__)
                .where(
                    LegacyClaimBatch.user_id == user_id,
                    LegacyClaimBatch.workspace_id == workspace_id,
                )
                .order_by(LegacyClaimBatch.created_at.desc())
            ).mappings().first()

    def preview(self, *, user_id: str, workspace_id: str) -> dict[str, Any]:
        latest = self._latest_batch(user_id, workspace_id)
        try:
            report = preview_legacy(
                self.projects_path,
                self.series_path,
                self.db_path,
            )
        except (LegacyDataError, MigrationError, OSError) as exc:
            summary = _batch_summary(latest) if latest is not None else {
                "projects": 0,
                "series": 0,
                "media": 0,
                "conflicts": 0,
            }
            summary["conflicts"] += 1
            state = "claimed" if latest is not None and latest["status"] == "claimed" else "blocked"
            return {
                "state": state,
                "source_sha256": None,
                "source_files": [],
                "summary": summary,
                "diagnostics": [{"type": "invalid_source", "message": str(exc)}],
                "rollback_available": bool(latest is not None and latest["status"] == "claimed"),
                "batch": _batch_payload(latest) if latest is not None else None,
            }

        source_files = list(report.get("source_files", []))
        diagnostics = [*report.get("errors", []), *report.get("conflicts", [])]
        project_ids = sorted(report.get("action_details", {}).get("projects", {}))
        if project_ids:
            with self.engine.connect() as connection:
                project_rows = connection.execute(
                    select(Project.id, Project.title).where(Project.id.in_(project_ids))
                ).all()
                existing_titles = set(
                    connection.execute(
                        select(Project.title).where(
                            Project.workspace_id == workspace_id,
                            Project.id.not_in(project_ids),
                        )
                    ).scalars()
                )
            seen_titles: set[str] = set()
            duplicate_titles: set[str] = set()
            for row in project_rows:
                if row.title in seen_titles or row.title in existing_titles:
                    duplicate_titles.add(row.title)
                seen_titles.add(row.title)
            diagnostics.extend(
                {"type": "duplicate_workspace_title", "title": title}
                for title in sorted(duplicate_titles)
            )

        if latest is not None and latest["status"] == "claimed":
            state = "claimed"
        elif diagnostics:
            state = "blocked"
        elif latest is not None:
            state = latest["status"]
        else:
            state = "ready"
        return {
            "state": state,
            "source_sha256": report.get("source_sha256"),
            "source_files": source_files,
            "summary": {
                "projects": int(report.get("counts", {}).get("projects", 0)),
                "series": int(report.get("counts", {}).get("series", 0)),
                "media": _media_count(source_files),
                "conflicts": len(diagnostics),
            },
            "diagnostics": diagnostics,
            "rollback_available": bool(latest is not None and latest["status"] == "claimed"),
            "batch": _batch_payload(latest) if latest is not None else None,
        }

    def status(self, *, user_id: str, workspace_id: str) -> dict[str, Any]:
        return self.preview(user_id=user_id, workspace_id=workspace_id)

    def apply(
        self,
        *,
        user_id: str,
        workspace_id: str,
        expected_source_sha256: str,
    ) -> dict[str, Any]:
        report = self.preview(user_id=user_id, workspace_id=workspace_id)
        if report["state"] == "blocked":
            raise LegacyClaimError(
                "LEGACY_CLAIM_BLOCKED",
                "旧数据预检存在冲突，无法认领",
            )
        if not report.get("source_sha256"):
            raise LegacyClaimError(
                "LEGACY_CLAIM_EMPTY",
                "没有可认领的旧数据",
            )
        if report["source_sha256"] != expected_source_sha256:
            raise LegacyClaimError(
                "LEGACY_CLAIM_SOURCE_CHANGED",
                "旧数据已发生变化，请重新预览后再确认",
            )

        project_ids = sorted(report.get("source_project_ids", []))
        if not project_ids:
            raw = preview_legacy(self.projects_path, self.series_path, self.db_path)
            project_ids = sorted(raw.get("action_details", {}).get("projects", {}))
        series_ids = sorted(
            preview_legacy(self.projects_path, self.series_path, self.db_path)
            .get("action_details", {})
            .get("series", {})
        )
        now = time.time()
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                latest = connection.execute(
                    select(LegacyClaimBatch.__table__)
                    .where(
                        LegacyClaimBatch.user_id == user_id,
                        LegacyClaimBatch.workspace_id == workspace_id,
                    )
                    .order_by(LegacyClaimBatch.created_at.desc())
                ).mappings().first()
                if (
                    latest is not None
                    and latest["status"] == "claimed"
                    and latest["source_sha256"] == expected_source_sha256
                ):
                    return {
                        **report,
                        "state": "claimed",
                        "rollback_available": True,
                        "idempotent": True,
                        "batch": _batch_payload(latest),
                    }

                rows = connection.execute(
                    select(Project.id, Project.workspace_id).where(Project.id.in_(project_ids))
                ).all()
                ownership = {row.id: row.workspace_id for row in rows}
                if set(ownership) != set(project_ids) or any(value is not None for value in ownership.values()):
                    raise LegacyClaimError(
                        "LEGACY_CLAIM_OWNERSHIP_CONFLICT",
                        "部分旧项目已被其他流程认领，请刷新状态后处理",
                    )

                result = connection.execute(
                    update(Project)
                    .where(Project.id.in_(project_ids), Project.workspace_id.is_(None))
                    .values(workspace_id=workspace_id)
                )
                if result.rowcount != len(project_ids):
                    raise LegacyClaimError(
                        "LEGACY_CLAIM_OWNERSHIP_CONFLICT",
                        "旧项目归属在认领期间发生变化",
                    )

                batch_id = uuid.uuid4().hex
                connection.execute(
                    LegacyClaimBatch.__table__.insert(),
                    {
                        "id": batch_id,
                        "user_id": user_id,
                        "workspace_id": workspace_id,
                        "source_sha256": expected_source_sha256,
                        "source_manifest_json": json.dumps(report["source_files"], ensure_ascii=False),
                        "mapping_json": json.dumps(
                            {"project_ids": project_ids, "series_ids": series_ids},
                            ensure_ascii=False,
                        ),
                        "project_count": report["summary"]["projects"],
                        "series_count": report["summary"]["series"],
                        "media_count": report["summary"]["media"],
                        "conflict_count": report["summary"]["conflicts"],
                        "status": "claimed",
                        "created_at": now,
                        "completed_at": now,
                        "rolled_back_at": None,
                    },
                )
                batch = connection.execute(
                    select(LegacyClaimBatch.__table__).where(LegacyClaimBatch.id == batch_id)
                ).mappings().one()

        return {
            **report,
            "state": "claimed",
            "rollback_available": True,
            "idempotent": False,
            "batch": _batch_payload(batch),
        }

    def rollback(self, *, user_id: str, workspace_id: str) -> dict[str, Any]:
        report = self.preview(user_id=user_id, workspace_id=workspace_id)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                latest = connection.execute(
                    select(LegacyClaimBatch.__table__)
                    .where(
                        LegacyClaimBatch.user_id == user_id,
                        LegacyClaimBatch.workspace_id == workspace_id,
                    )
                    .order_by(LegacyClaimBatch.created_at.desc())
                ).mappings().first()
                if latest is None:
                    raise LegacyClaimError(
                        "LEGACY_CLAIM_NOT_FOUND",
                        "没有可回滚的认领批次",
                        status_code=404,
                    )
                if latest["status"] == "rolled_back":
                    return {
                        **report,
                        "state": "rolled_back",
                        "rollback_available": False,
                        "idempotent": True,
                        "batch": _batch_payload(latest),
                    }

                project_ids = list(json.loads(latest["mapping_json"]).get("project_ids", []))
                rows = connection.execute(
                    select(Project.id, Project.workspace_id).where(Project.id.in_(project_ids))
                ).all()
                ownership = {row.id: row.workspace_id for row in rows}
                if set(ownership) != set(project_ids) or any(
                    value != workspace_id for value in ownership.values()
                ):
                    raise LegacyClaimError(
                        "LEGACY_CLAIM_ROLLBACK_CONFLICT",
                        "项目归属已在认领后发生变化，无法安全回滚",
                    )

                connection.execute(
                    update(Project)
                    .where(Project.id.in_(project_ids), Project.workspace_id == workspace_id)
                    .values(workspace_id=None)
                )
                rolled_back_at = time.time()
                connection.execute(
                    update(LegacyClaimBatch)
                    .where(LegacyClaimBatch.id == latest["id"])
                    .values(status="rolled_back", rolled_back_at=rolled_back_at)
                )
                latest = {**latest, "status": "rolled_back", "rolled_back_at": rolled_back_at}

        return {
            **report,
            "state": "rolled_back",
            "rollback_available": False,
            "idempotent": False,
            "batch": _batch_payload(latest),
        }


__all__ = ["LegacyClaimError", "LegacyClaimService"]
