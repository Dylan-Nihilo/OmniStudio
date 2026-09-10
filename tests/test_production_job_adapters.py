from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.pool import StaticPool

from src.apps.comic_gen.job_adapters import ProductionJobAdapter
from src.storage.db import create_engine, init_schema
from src.storage.job_repository import JobRepository
from src.storage.schema import Workspace


@pytest.fixture
def adapter_and_repository():
    engine = create_engine(":memory:", poolclass=StaticPool, connect_args={"check_same_thread": False})
    init_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            Workspace.__table__.insert(),
            {"id": "workspace-1", "name": "Acceptance", "created_at": 1.0, "updated_at": 1.0},
        )
    calls: list[dict[str, Any]] = []

    def dispatch(item):
        calls.append({"item_id": item.id, "kind": item.kind})
        return [{"id": f"media-{item.id}", "kind": "media", "uri": f"output/{item.id}.bin"}]

    repository = JobRepository(engine)
    adapter = ProductionJobAdapter(repository, dispatchers={kind: dispatch for kind in ProductionJobAdapter.SUPPORTED_KINDS})
    try:
        yield adapter, repository, calls
    finally:
        engine.dispose()


def test_create_is_workspace_idempotent_and_start_dispatches_once(adapter_and_repository):
    adapter, repository, calls = adapter_and_repository
    first = adapter.create("video", "workspace-1", None, None, {"shot_id": "shot-1"}, "video:shot-1:v1")
    duplicate = adapter.create("video", "workspace-1", None, None, {"shot_id": "shot-1"}, "video:shot-1:v1")

    assert duplicate.id == first.id
    assert duplicate.idempotent is True
    assert repository.list_jobs("workspace-1").total == 1

    adapter.start(first.id)
    adapter.start(first.id)

    item = repository.get_item(first.id)
    assert item.status == "succeeded"
    assert item.media_refs[0]["uri"] == f"output/{first.id}.bin"
    assert len(calls) == 1


def test_failed_dispatch_can_retry_and_preserves_retry_lineage(adapter_and_repository):
    adapter, repository, calls = adapter_and_repository
    attempts = 0

    def flaky(item):
        nonlocal attempts
        attempts += 1
        calls.append({"item_id": item.id, "kind": item.kind})
        if attempts == 1:
            raise TimeoutError("provider timed out")
        return [{"id": "media-retry", "kind": "video", "uri": "output/retry.mp4"}]

    adapter.set_dispatcher("video", flaky)
    original = adapter.create("video", "workspace-1", None, None, {}, "video:retry:v1")
    adapter.start(original.id)
    assert repository.get_item(original.id).status == "failed"

    retry = adapter.retry(original.id)
    assert retry.retry_of == original.id
    assert retry.status == "pending"
    adapter.start(retry.id)
    assert repository.get_item(retry.id).status == "succeeded"
    assert attempts == 2


def test_recover_replays_pending_item_left_behind_by_restart(adapter_and_repository):
    adapter, repository, calls = adapter_and_repository
    item = adapter.create("video", "workspace-1", None, None, {}, "video:pending-recovery:v1")

    recovered = adapter.recover_inflight("workspace-1")

    assert recovered == {"recovered": 1, "failed": 0, "skipped": 0}
    assert repository.get_item(item.id).status == "succeeded"
    assert [call["item_id"] for call in calls] == [item.id]


def test_cancel_prevents_pending_dispatch_and_late_success(adapter_and_repository):
    adapter, repository, calls = adapter_and_repository
    pending = adapter.create("audio", "workspace-1", None, None, {}, "audio:cancel:v1")
    canceled = adapter.cancel(pending.id)
    assert canceled.status == "canceled"
    adapter.start(pending.id)
    assert calls == []

    def cancel_during_dispatch(item):
        adapter.cancel(item.id)
        return [{"id": "late", "kind": "audio", "uri": "output/late.wav"}]

    adapter.set_dispatcher("audio", cancel_during_dispatch)
    running = adapter.create("audio", "workspace-1", None, None, {}, "audio:late:v1")
    adapter.start(running.id)
    assert repository.get_item(running.id).status == "canceled"


@pytest.mark.parametrize("kind", sorted(ProductionJobAdapter.SUPPORTED_KINDS))
def test_supported_production_kinds_share_one_dispatch_contract(adapter_and_repository, kind):
    adapter, repository, _calls = adapter_and_repository
    item = adapter.create(kind, "workspace-1", None, None, {"kind": kind}, f"{kind}:contract:v1")
    adapter.start(item.id)
    assert repository.get_item(item.id).status == "succeeded"
