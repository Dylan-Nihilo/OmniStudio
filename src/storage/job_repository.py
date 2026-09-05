"""Persistent Job/JobItem ledger used by all asynchronous Studio work."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, select, update
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
