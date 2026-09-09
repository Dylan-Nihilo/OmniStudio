"""Persistent Job/JobItem ledger used by all asynchronous Studio work."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.engine import Engine

from src.apps.comic_gen.contracts import JobStatus, MediaRef, summarize_job_items

from .errors import StorageError
from .schema import Job, JobItem, JobItemEvent


@dataclass(frozen=True)
class JobItemRecord:
    id: str
    job_id: str
    workspace_id: str
    project_id: str | None
    episode_id: str | None
    kind: str
    status: str
    progress: float
    idempotency_key: str
    retry_of: str | None
    payload: dict[str, Any]
    media_refs: list[dict[str, Any]]
    error_code: str | None
    error_message: str | None
    created_at: float
    updated_at: float
    started_at: float | None
    finished_at: float | None
    idempotent: bool = False


@dataclass(frozen=True)
class JobRecord:
    id: str
    workspace_id: str
    project_id: str | None
    episode_id: str | None
    kind: str
    status: str
    total: int
    succeeded: int
    failed: int
    canceled: int
    skipped: int
    items: list[JobItemRecord] = field(default_factory=list)
    created_at: float = 0.0
    updated_at: float = 0.0


@dataclass(frozen=True)
class PaginatedJobs:
    items: list[JobRecord]
    page: int
    page_size: int
    total: int


class JobRepository:
    """Small Core-style repository with atomic state transitions."""

    _ALLOWED_TRANSITIONS = {
        JobStatus.PENDING.value: {
            JobStatus.PROCESSING.value,
            JobStatus.CANCELED.value,
            JobStatus.FAILED.value,
            JobStatus.SKIPPED.value,
        },
        JobStatus.PROCESSING.value: {
            JobStatus.SUCCEEDED.value,
            JobStatus.FAILED.value,
            JobStatus.CANCELED.value,
        },
        JobStatus.SUCCEEDED.value: set(),
        JobStatus.FAILED.value: set(),
        JobStatus.CANCELED.value: set(),
        JobStatus.SKIPPED.value: set(),
    }
    _TERMINAL = {
        JobStatus.SUCCEEDED.value,
        JobStatus.FAILED.value,
        JobStatus.CANCELED.value,
        JobStatus.SKIPPED.value,
    }

    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def create_job(
        self,
        workspace_id: str,
        kind: str,
        project_id: str | None = None,
        episode_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> JobRecord:
        now = time.time()
        job_id = str(uuid.uuid4())
        with self.engine.begin() as connection:
            connection.execute(
                Job.__table__.insert().values(
                    id=job_id,
                    workspace_id=workspace_id,
                    project_id=project_id,
                    episode_id=episode_id,
                    kind=kind,
                    metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
                    created_at=now,
                    updated_at=now,
                )
            )
        return JobRecord(
            id=job_id,
            workspace_id=workspace_id,
            project_id=project_id,
            episode_id=episode_id,
            kind=kind,
            status="pending",
            total=0,
            succeeded=0,
            failed=0,
            canceled=0,
            skipped=0,
            created_at=now,
            updated_at=now,
        )

    def create_item(
        self,
        job_id: str,
        kind: str,
        idempotency_key: str,
        payload: dict[str, Any] | None = None,
        retry_of: str | None = None,
    ) -> JobItemRecord:
        now = time.time()
        item_id = str(uuid.uuid4())
        with self.engine.begin() as connection:
            job = connection.execute(
                select(Job.__table__).where(Job.__table__.c.id == job_id)
            ).mappings().first()
            if job is None:
                raise StorageError(f"Job {job_id} not found")
            existing = connection.execute(
                select(JobItem.__table__).where(
                    JobItem.__table__.c.workspace_id == job["workspace_id"],
                    JobItem.__table__.c.idempotency_key == idempotency_key,
                )
            ).mappings().first()
            if existing is not None:
                return self._item_record(existing, idempotent=True)
            connection.execute(
                JobItem.__table__.insert().values(
                    id=item_id,
                    job_id=job_id,
                    workspace_id=job["workspace_id"],
                    project_id=job["project_id"],
                    episode_id=job["episode_id"],
                    kind=kind,
                    status=JobStatus.PENDING.value,
                    progress=0.0,
                    idempotency_key=idempotency_key,
                    retry_of=retry_of,
                    payload_json=json.dumps(payload or {}, ensure_ascii=False),
                    media_refs_json="[]",
                    created_at=now,
                    updated_at=now,
                )
            )
            row = connection.execute(
                select(JobItem.__table__).where(JobItem.__table__.c.id == item_id)
            ).mappings().one()
        return self._item_record(row)

    def create_retry(self, failed_item_id: str, idempotency_key: str) -> JobItemRecord:
        with self.engine.begin() as connection:
            source = connection.execute(
                select(JobItem.__table__).where(JobItem.__table__.c.id == failed_item_id)
            ).mappings().first()
            if source is None:
                raise StorageError(f"JobItem {failed_item_id} not found")
            if source["status"] != JobStatus.FAILED.value:
                raise StorageError("only failed items can be retried")
            existing = connection.execute(
                select(JobItem.__table__).where(
                    JobItem.__table__.c.workspace_id == source["workspace_id"],
                    JobItem.__table__.c.idempotency_key == idempotency_key,
                )
            ).mappings().first()
            if existing is not None:
                return self._item_record(existing, idempotent=True)
            now = time.time()
            item_id = str(uuid.uuid4())
            connection.execute(
                JobItem.__table__.insert().values(
                    id=item_id,
                    job_id=source["job_id"],
                    workspace_id=source["workspace_id"],
                    project_id=source["project_id"],
                    episode_id=source["episode_id"],
                    kind=source["kind"],
                    status=JobStatus.PENDING.value,
                    progress=0.0,
                    idempotency_key=idempotency_key,
                    retry_of=failed_item_id,
                    payload_json=source["payload_json"],
                    media_refs_json="[]",
                    created_at=now,
                    updated_at=now,
                )
            )
            row = connection.execute(
                select(JobItem.__table__).where(JobItem.__table__.c.id == item_id)
            ).mappings().one()
        return self._item_record(row)

    def job_exists(self, job_id: str) -> bool:
        """Return whether an id belongs to a unified job in any Workspace."""
        with self.engine.connect() as connection:
            return connection.execute(
                select(Job.__table__.c.id).where(Job.__table__.c.id == job_id)
            ).first() is not None

    def delete_job_if_empty(self, job_id: str) -> bool:
        """Remove a job created by a failed idempotent insert race."""
        with self.engine.begin() as connection:
            has_items = connection.execute(
                select(JobItem.__table__.c.id).where(JobItem.__table__.c.job_id == job_id).limit(1)
            ).first()
            if has_items is not None:
                return False
            result = connection.execute(delete(Job.__table__).where(Job.__table__.c.id == job_id))
            return bool(result.rowcount)

    def find_item_by_idempotency(
        self,
        workspace_id: str,
        idempotency_key: str,
    ) -> JobItemRecord | None:
        """Find an existing item without crossing Workspace boundaries."""
        with self.engine.connect() as connection:
            row = connection.execute(
                select(JobItem.__table__).where(
                    JobItem.__table__.c.workspace_id == workspace_id,
                    JobItem.__table__.c.idempotency_key == idempotency_key,
                )
            ).mappings().first()
        return self._item_record(row, idempotent=True) if row is not None else None

    def get_job(self, workspace_id: str, job_id: str) -> JobRecord | None:
        """Read one unified job only when it belongs to the requested Workspace."""
        with self.engine.connect() as connection:
            row = connection.execute(
                select(Job.__table__).where(
                    Job.__table__.c.id == job_id,
                    Job.__table__.c.workspace_id == workspace_id,
                )
            ).mappings().first()
            return self._job_record(connection, row) if row is not None else None

    def get_item(self, item_id: str) -> JobItemRecord | None:
        """Read one item by id for an adapter after its caller checks scope."""
        with self.engine.connect() as connection:
            row = connection.execute(
                select(JobItem.__table__).where(JobItem.__table__.c.id == item_id)
            ).mappings().first()
        return self._item_record(row) if row is not None else None

    def list_inflight(self, workspace_id: str | None = None) -> list[JobItemRecord]:
        """Return processing items that need adapter recovery after restart."""
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(JobItem.__table__).where(
                    JobItem.__table__.c.status == JobStatus.PROCESSING.value,
                    *([JobItem.__table__.c.workspace_id == workspace_id] if workspace_id else []),
                ).order_by(JobItem.__table__.c.created_at)
            ).mappings().all()
        return [self._item_record(row) for row in rows]

    def record_item_event(self, item_id: str, to_status: str, *, error_code: str | None = None) -> None:
        """Append an adapter lifecycle event without changing item status."""
        with self.engine.begin() as connection:
            row = connection.execute(
                select(JobItem.__table__.c.status).where(JobItem.__table__.c.id == item_id)
            ).first()
            if row is None:
                raise StorageError(f"JobItem {item_id} not found")
            connection.execute(
                JobItemEvent.__table__.insert().values(
                    id=str(uuid.uuid4()),
                    item_id=item_id,
                    from_status=row[0],
                    to_status=to_status,
                    progress=None,
                    error_code=error_code,
                    created_at=time.time(),
                )
            )

    def list_item_events(self, workspace_id: str, job_id: str) -> list[dict[str, Any]] | None:
        """Return status history for a Workspace-owned job, or ``None`` if hidden."""
        with self.engine.connect() as connection:
            owned = connection.execute(
                select(Job.__table__.c.id).where(
                    Job.__table__.c.id == job_id,
                    Job.__table__.c.workspace_id == workspace_id,
                )
            ).first()
            if owned is None:
                return None
            rows = connection.execute(
                select(JobItemEvent.__table__)
                .join(JobItem.__table__, JobItemEvent.__table__.c.item_id == JobItem.__table__.c.id)
                .where(JobItem.__table__.c.job_id == job_id)
                .order_by(JobItemEvent.__table__.c.created_at, JobItemEvent.__table__.c.id)
            ).mappings().all()
        return [
            {
                "id": row["id"],
                "item_id": row["item_id"],
                "from_status": row["from_status"],
                "to_status": row["to_status"],
                "progress": row["progress"],
                "error_code": row["error_code"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def cancel_job(self, workspace_id: str, job_id: str) -> JobRecord | None:
        """Cancel all pending/processing items while preserving terminal states."""
        job = self.get_job(workspace_id, job_id)
        if job is None:
            return None
        for item in job.items:
            if item.status in {JobStatus.PENDING.value, JobStatus.PROCESSING.value}:
                self.transition_item(item.id, JobStatus.CANCELED.value, error={"code": "CANCELED", "message": "任务已取消"})
        return self.get_job(workspace_id, job_id)

    def retry_failed_items(
        self,
        workspace_id: str,
        job_id: str,
        *,
        item_ids: list[str] | None = None,
        idempotency_key: str | None = None,
    ) -> JobRecord | None:
        """Create one deterministic retry item per selected failed item."""
        job = self.get_job(workspace_id, job_id)
        if job is None:
            return None
        selected = set(item_ids or [])
        for item in job.items:
            if item.status != JobStatus.FAILED.value or (selected and item.id not in selected):
                continue
            key = f"{idempotency_key}:{item.id}" if idempotency_key else f"retry:{item.id}"
            self.create_retry(item.id, key)
        return self.get_job(workspace_id, job_id)

    def summarize(
        self,
        workspace_id: str,
        *,
        project_id: str | None = None,
        episode_id: str | None = None,
    ) -> dict[str, int]:
        """Aggregate item states without exposing jobs from another Workspace."""
        with self.engine.connect() as connection:
            query = select(JobItem.__table__.c.status).join(
                Job.__table__, JobItem.__table__.c.job_id == Job.__table__.c.id
            ).where(Job.__table__.c.workspace_id == workspace_id)
            if project_id:
                query = query.where(Job.__table__.c.project_id == project_id)
            if episode_id:
                query = query.where(Job.__table__.c.episode_id == episode_id)
            statuses = [row[0] for row in connection.execute(query)]
        counts = {"pending": 0, "processing": 0, "succeeded": 0, "failed": 0, "canceled": 0, "skipped": 0}
        for status in statuses:
            if status in counts:
                counts[status] += 1
        counts["running"] = counts["pending"] + counts["processing"]
        counts["total"] = len(statuses)
        return counts

    def transition_item(
        self,
        item_id: str,
        target_status: str,
        *,
        progress: float | None = None,
        error: dict[str, str] | None = None,
        media_refs: list[dict[str, Any] | MediaRef] | None = None,
    ) -> JobItemRecord:
        if target_status not in {status.value for status in JobStatus}:
            raise StorageError(f"unknown job item status: {target_status}")
        with self.engine.begin() as connection:
            row = connection.execute(
                select(JobItem.__table__).where(JobItem.__table__.c.id == item_id)
            ).mappings().first()
            if row is None:
                raise StorageError(f"JobItem {item_id} not found")
            current = row["status"]
            if current in self._TERMINAL:
                raise StorageError("cannot transition a terminal job item")
            if target_status not in self._ALLOWED_TRANSITIONS[current]:
                raise StorageError(f"invalid transition: {current} -> {target_status}")
            refs = [item.model_dump() if isinstance(item, MediaRef) else dict(item) for item in (media_refs or [])]
            if target_status == JobStatus.SUCCEEDED.value and not refs:
                raise StorageError("succeeded job item requires a media reference")
            now = time.time()
            next_progress = 1.0 if target_status == JobStatus.SUCCEEDED.value else (progress if progress is not None else row["progress"])
            if not 0.0 <= next_progress <= 1.0:
                raise StorageError("progress must be between 0 and 1")
            finished_at = now if target_status in self._TERMINAL else row["finished_at"]
            started_at = now if target_status == JobStatus.PROCESSING.value and row["started_at"] is None else row["started_at"]
            connection.execute(
                update(JobItem.__table__)
                .where(JobItem.__table__.c.id == item_id)
                .values(
                    status=target_status,
                    progress=next_progress,
                    media_refs_json=json.dumps(refs, ensure_ascii=False),
                    error_code=(error or {}).get("code"),
                    error_message=(error or {}).get("message"),
                    started_at=started_at,
                    finished_at=finished_at,
                    updated_at=now,
                )
            )
            connection.execute(
                JobItemEvent.__table__.insert().values(
                    id=str(uuid.uuid4()),
                    item_id=item_id,
                    from_status=current,
                    to_status=target_status,
                    progress=next_progress,
                    error_code=(error or {}).get("code"),
                    created_at=now,
                )
            )
            connection.execute(
                update(Job.__table__)
                .where(Job.__table__.c.id == row["job_id"])
                .values(updated_at=now)
            )
            updated = connection.execute(
                select(JobItem.__table__).where(JobItem.__table__.c.id == item_id)
            ).mappings().one()
        return self._item_record(updated)

    def update_item_payload(self, item_id: str, payload: dict[str, Any]) -> JobItemRecord:
        """Persist worker-produced details such as a cleanup report."""
        now = time.time()
        with self.engine.begin() as connection:
            row = connection.execute(
                select(JobItem.__table__).where(JobItem.__table__.c.id == item_id)
            ).mappings().first()
            if row is None:
                raise StorageError(f"JobItem {item_id} not found")
            connection.execute(
                update(JobItem.__table__)
                .where(JobItem.__table__.c.id == item_id)
                .values(payload_json=json.dumps(payload, ensure_ascii=False), updated_at=now)
            )
            connection.execute(
                update(Job.__table__)
                .where(Job.__table__.c.id == row["job_id"])
                .values(updated_at=now)
            )
            updated = connection.execute(
                select(JobItem.__table__).where(JobItem.__table__.c.id == item_id)
            ).mappings().one()
        return self._item_record(updated)

    def list_jobs(
        self,
        workspace_id: str,
        *,
        project_id: str | None = None,
        episode_id: str | None = None,
        status: str | None = None,
        query: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> PaginatedJobs:
        page = max(1, page)
        page_size = min(100, max(1, page_size))
        with self.engine.connect() as connection:
            jobs = list(
                connection.execute(
                    select(Job.__table__)
                    .where(
                        Job.__table__.c.workspace_id == workspace_id,
                        *([Job.__table__.c.project_id == project_id] if project_id else []),
                        *([Job.__table__.c.episode_id == episode_id] if episode_id else []),
                    )
                    .order_by(Job.__table__.c.updated_at.desc())
                ).mappings()
            )
            records = [self._job_record(connection, job) for job in jobs]
            if status:
                records = [record for record in records if record.status == status]
            if query:
                needle = query.casefold()
                records = [record for record in records if needle in record.kind.casefold()]
            total = len(records)
            start = (page - 1) * page_size
            return PaginatedJobs(records[start : start + page_size], page, page_size, total)

    def recover_inflight(
        self,
        workspace_id: str | None = None,
        *,
        recoverable_kinds: set[str] | None = None,
    ) -> dict[str, int]:
        recoverable = recoverable_kinds or set()
        resumed = failed = 0
        with self.engine.begin() as connection:
            rows = list(
                connection.execute(
                    select(JobItem.__table__).where(
                        JobItem.__table__.c.status == JobStatus.PROCESSING.value,
                        *([JobItem.__table__.c.workspace_id == workspace_id] if workspace_id else []),
                    )
                ).mappings()
            )
            now = time.time()
            for row in rows:
                if row["kind"] in recoverable:
                    resumed += 1
                    continue
                failed += 1
                connection.execute(
                    update(JobItem.__table__)
                    .where(JobItem.__table__.c.id == row["id"])
                    .values(
                        status=JobStatus.FAILED.value,
                        error_code="RECOVERY_UNAVAILABLE",
                        error_message="任务重启后无法恢复",
                        finished_at=now,
                        updated_at=now,
                    )
                )
                connection.execute(
                    JobItemEvent.__table__.insert().values(
                        id=str(uuid.uuid4()),
                        item_id=row["id"],
                        from_status=JobStatus.PROCESSING.value,
                        to_status=JobStatus.FAILED.value,
                        error_code="RECOVERY_UNAVAILABLE",
                        created_at=now,
                    )
                )
        return {"resumed": resumed, "failed": failed}

    @staticmethod
    def _item_record(row: Any, *, idempotent: bool = False) -> JobItemRecord:
        return JobItemRecord(
            id=row["id"],
            job_id=row["job_id"],
            workspace_id=row["workspace_id"],
            project_id=row["project_id"],
            episode_id=row["episode_id"],
            kind=row["kind"],
            status=row["status"],
            progress=float(row["progress"]),
            idempotency_key=row["idempotency_key"],
            retry_of=row["retry_of"],
            payload=json.loads(row["payload_json"]),
            media_refs=json.loads(row["media_refs_json"]),
            error_code=row["error_code"],
            error_message=row["error_message"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            idempotent=idempotent,
        )

    def _job_record(self, connection: Any, row: Any) -> JobRecord:
        items = [
            self._item_record(item)
            for item in connection.execute(
                select(JobItem.__table__)
                .where(JobItem.__table__.c.job_id == row["id"])
                .order_by(JobItem.__table__.c.created_at)
            ).mappings()
        ]
        summary = summarize_job_items(
            [
                # Contract conversion is limited to fields used by the summary helper.
                type("SummaryItem", (), {"status": JobStatus(item.status)})() for item in items
            ]
        )
        return JobRecord(
            id=row["id"],
            workspace_id=row["workspace_id"],
            project_id=row["project_id"],
            episode_id=row["episode_id"],
            kind=row["kind"],
            status=str(summary["status"]),
            total=int(summary["total"]),
            succeeded=int(summary["succeeded"]),
            failed=int(summary["failed"]),
            canceled=int(summary["canceled"]),
            skipped=int(summary["skipped"]),
            items=items,
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )


__all__ = ["JobItemRecord", "JobRecord", "JobRepository", "PaginatedJobs"]
