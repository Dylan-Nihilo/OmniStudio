from __future__ import annotations

import pytest
from sqlalchemy.pool import StaticPool

from src.storage.db import create_engine, init_schema
from src.storage.job_repository import JobRepository
from src.storage.schema import Workspace


@pytest.fixture
def repository():
    engine = create_engine(
        ":memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    init_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            Workspace.__table__.insert(),
            {
                "id": "workspace-1",
                "name": "Acceptance",
                "created_at": 1_700_000_000.0,
                "updated_at": 1_700_000_000.0,
            },
        )
    try:
        yield JobRepository(engine)
    finally:
        engine.dispose()


def test_create_job_and_item_persists_workspace_and_input(repository):
    job = repository.create_job("workspace-1", "asset_batch")
    item = repository.create_item(
        job.id,
        "image",
        "workspace-1:image:character-1:v1",
        {"asset_id": "character-1", "prompt": "A portrait"},
    )

    assert job.workspace_id == "workspace-1"
    assert item.job_id == job.id
    assert item.status == "pending"
    assert item.payload == {"asset_id": "character-1", "prompt": "A portrait"}


def test_duplicate_idempotency_key_returns_existing_item(repository):
    job = repository.create_job("workspace-1", "video_batch")
    first = repository.create_item(job.id, "video", "same-key", {"shot_id": "shot-1"})
    second = repository.create_item(job.id, "video", "same-key", {"shot_id": "shot-1"})

    assert second.id == first.id
    assert second.idempotent is True
    assert repository.list_jobs("workspace-1").total == 1


@pytest.mark.parametrize("length", [255, 256, 1016])
def test_long_keys_fit_mysql_without_losing_deduplication(repository, length):
    job = repository.create_job("workspace-1", "asset")
    key = "场" * length
    first = repository.create_item(job.id, "image", key, {"prompt": key})
    assert len(first.idempotency_key) <= 255
    assert first.payload["prompt"] == key
    assert repository.create_item(job.id, "image", key).id == first.id
    assert repository.find_item_by_idempotency("workspace-1", key).id == first.id
    assert repository.find_item_by_idempotency("another-workspace", key) is None
    assert repository.create_item(job.id, "image", key[:-1] + "景").id != first.id
    if length == 255:
        assert first.idempotency_key == key


def test_long_retry_keys_fit_mysql_and_remain_idempotent(repository):
    job = repository.create_job("workspace-1", "video")
    source = repository.create_item(job.id, "video", "source")
    repository.transition_item(source.id, "failed")
    key = "retry:" + "x" * 1000
    retry = repository.create_retry(source.id, key)
    assert len(retry.idempotency_key) <= 255
    assert retry.retry_of == source.id
    assert repository.create_retry(source.id, key).id == retry.id
    assert repository.find_item_by_idempotency("workspace-1", key).id == retry.id


def test_legacy_sqlite_long_key_is_still_found(repository):
    from src.storage.schema import JobItem

    job = repository.create_job("workspace-1", "image")
    item = repository.create_item(job.id, "image", "legacy")
    key = "legacy:" + "x" * 1000
    with repository.engine.begin() as connection:
        connection.execute(JobItem.__table__.update().where(JobItem.id == item.id).values(idempotency_key=key))
    assert repository.find_item_by_idempotency("workspace-1", key).id == item.id
    assert repository.create_item(job.id, "image", key).id == item.id
    repository.transition_item(item.id, "failed")
    assert repository.create_retry(item.id, key).id == item.id


def test_retry_creates_new_item_linked_to_failed_item(repository):
    job = repository.create_job("workspace-1", "video")
    failed = repository.create_item(job.id, "video", "original-key", {"shot_id": "shot-1"})
    repository.transition_item(failed.id, "processing")
    repository.transition_item(
        failed.id,
        "failed",
        error={"code": "PROVIDER_TIMEOUT", "message": "provider timed out"},
    )

    retry = repository.create_retry(failed.id, "retry-key")

    assert retry.id != failed.id
    assert retry.retry_of == failed.id
    assert retry.status == "pending"
    assert retry.payload == failed.payload


def test_list_jobs_filters_and_paginates_items(repository):
    first = repository.create_job("workspace-1", "asset")
    second = repository.create_job("workspace-1", "video")
    first_item = repository.create_item(first.id, "image", "asset-key", {})
    repository.transition_item(first_item.id, "skipped")
    second_item = repository.create_item(second.id, "video", "video-key", {})
    repository.transition_item(second_item.id, "skipped")
    repository.transition_item(
        repository.create_item(second.id, "video", "video-key-2", {}).id,
        "skipped",
    )

    page = repository.list_jobs("workspace-1", status="processing", page=1, page_size=1)

    assert page.total == 0
    assert page.items == []
    assert repository.list_jobs("workspace-1", query="video").total == 1
