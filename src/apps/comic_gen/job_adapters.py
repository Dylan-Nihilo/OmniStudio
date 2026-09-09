"""Unified dispatch boundary for production jobs.

The legacy pipeline still owns provider-specific persistence.  This adapter
puts a durable JobItem in front of that work so every production entry point
can share idempotency, cancellation, retry, and restart recovery semantics.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from sqlalchemy.exc import IntegrityError

from ...storage.errors import StorageError
from ...storage.job_repository import JobItemRecord, JobRepository
from .contracts import MediaRef, sanitize_error_text

DispatchResult = Sequence[MediaRef | Mapping[str, Any]]
Dispatcher = Callable[[JobItemRecord], DispatchResult]


class ProductionJobAdapter:
    """Coordinate durable JobItems with provider dispatch callbacks."""

    SUPPORTED_KINDS = frozenset({"asset", "asset_batch", "storyboard", "video", "audio", "tts", "export"})

    def __init__(self, repository: JobRepository, *, dispatchers: Mapping[str, Dispatcher] | None = None):
        self.repository = repository
        self._dispatchers: dict[str, Dispatcher] = dict(dispatchers or {})

    def set_dispatcher(self, kind: str, dispatcher: Dispatcher) -> None:
        self._validate_kind(kind)
        self._dispatchers[kind] = dispatcher

    def create(
        self,
        kind: str,
        workspace_id: str,
        project_id: str | None,
        episode_id: str | None,
        payload: dict[str, Any] | None,
        idempotency_key: str,
    ) -> JobItemRecord:
        self._validate_kind(kind)
        if not workspace_id.strip() or not idempotency_key.strip():
            raise StorageError("workspace_id and idempotency_key are required")
        existing = self.repository.find_item_by_idempotency(workspace_id, idempotency_key)
        if existing is not None:
            return existing
        job = self.repository.create_job(
            workspace_id,
            f"production.{kind}",
            project_id=project_id,
            episode_id=episode_id,
        )
        try:
            return self.repository.create_item(job.id, kind, idempotency_key, payload or {})
        except IntegrityError:
            # A concurrent request may win the unique Workspace/key race
            # between the lookup above and the insert.  Return its item and
            # clean up the empty job created by this losing request.
            existing = self.repository.find_item_by_idempotency(workspace_id, idempotency_key)
            if existing is not None:
                self.repository.delete_job_if_empty(job.id)
                return existing
            raise

    def start(self, item_id: str, *, workspace_id: str | None = None) -> JobItemRecord:
        item = self._owned_item(item_id, workspace_id)
        if item.status != "pending":
            return item
        try:
            item = self.repository.transition_item(item.id, "processing", progress=0.0)
        except StorageError:
            current = self._owned_item(item_id, workspace_id)
            if current.status != "pending":
                return current
            raise
        return self._dispatch_and_finish(item, workspace_id=workspace_id)

    def cancel(self, item_id: str, *, workspace_id: str | None = None) -> JobItemRecord:
        item = self._owned_item(item_id, workspace_id)
        if item.status in {"pending", "processing"}:
            return self.repository.transition_item(item.id, "canceled", error={"code": "CANCELED", "message": "任务已取消"})
        return item

    def retry(self, item_id: str, *, workspace_id: str | None = None) -> JobItemRecord:
        item = self._owned_item(item_id, workspace_id)
        if item.status != "failed":
            raise StorageError("only failed production items can be retried")
        return self.repository.create_retry(item.id, f"retry:{item.id}")

    def recover(self, item_id: str, *, workspace_id: str | None = None) -> JobItemRecord:
        item = self._owned_item(item_id, workspace_id)
        if item.status != "processing":
            return item
        self.repository.record_item_event(item.id, "recovered")
        return self._dispatch_and_finish(item, workspace_id=workspace_id)

    def recover_inflight(self, workspace_id: str | None = None) -> dict[str, int]:
        report = {"recovered": 0, "failed": 0, "skipped": 0}
        for item in self.repository.list_inflight(workspace_id):
            if item.kind not in self.SUPPORTED_KINDS:
                self.repository.transition_item(
                    item.id,
                    "failed",
                    error={"code": "RECOVERY_UNAVAILABLE", "message": "任务重启后无法恢复"},
                )
                report["failed"] += 1
                continue
            try:
                result = self.recover(item.id, workspace_id=workspace_id)
            except Exception:
                report["failed"] += 1
            else:
                report["recovered" if result.status == "succeeded" else "failed"] += 1
        return report

    def _dispatch_and_finish(self, item: JobItemRecord, *, workspace_id: str | None) -> JobItemRecord:
        dispatcher = self._dispatchers.get(item.kind)
        if dispatcher is None:
            return self._fail_if_active(item, workspace_id, "JOB_DISPATCH_UNAVAILABLE", "没有注册生产任务调度器")
        try:
            media_refs = list(dispatcher(item))
            if not media_refs and not item.payload.get("allow_empty_result"):
                return self._fail_if_active(item, workspace_id, "PROVIDER_EMPTY_RESULT", "provider 未返回媒体结果")
            current = self._owned_item(item.id, workspace_id)
            if current.status == "canceled":
                return current
            return self.repository.transition_item(item.id, "succeeded", media_refs=list(media_refs))
        except Exception as exc:
            return self._fail_if_active(item, workspace_id, "PROVIDER_DISPATCH_FAILED", sanitize_error_text(str(exc)))

    def _fail_if_active(
        self,
        item: JobItemRecord,
        workspace_id: str | None,
        code: str,
        message: str,
    ) -> JobItemRecord:
        current = self._owned_item(item.id, workspace_id)
        if current.status == "canceled":
            return current
        return self.repository.transition_item(item.id, "failed", error={"code": code, "message": message})

    def _owned_item(self, item_id: str, workspace_id: str | None) -> JobItemRecord:
        item = self.repository.get_item(item_id)
        if item is None:
            raise StorageError(f"JobItem {item_id} not found")
        if workspace_id is not None and item.workspace_id != workspace_id:
            raise StorageError(f"JobItem {item_id} is outside the active Workspace")
        return item

    @classmethod
    def _validate_kind(cls, kind: str) -> None:
        if kind not in cls.SUPPORTED_KINDS:
            raise StorageError(f"unsupported production job kind: {kind}")


__all__ = ["ProductionJobAdapter", "Dispatcher", "DispatchResult"]
