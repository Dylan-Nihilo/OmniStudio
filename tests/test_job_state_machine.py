from __future__ import annotations

import pytest
from sqlalchemy.pool import StaticPool

from src.storage.db import create_engine, init_schema
from src.storage.errors import StorageError
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
            {"id": "workspace-1", "name": "Acceptance", "created_at": 1.0, "updated_at": 1.0},
        )
    try:
        yield JobRepository(engine)
    finally:
        engine.dispose()


def test_processing_item_can_succeed_only_after_media_is_persisted(repository):
    job = repository.create_job("workspace-1", "video")
    item = repository.create_item(job.id, "video", "video-key", {})
    repository.transition_item(item.id, "processing", progress=0.4)

    with pytest.raises(StorageError, match="media reference"):
        repository.transition_item(item.id, "succeeded")

    succeeded = repository.transition_item(
        item.id,
        "succeeded",
        progress=1.0,
        media_refs=[{"id": "media-1", "kind": "video", "uri": "video/shot-1.mp4"}],
    )

    assert succeeded.status == "succeeded"
    assert succeeded.progress == 1.0


def test_terminal_item_rejects_late_provider_transition(repository):
    job = repository.create_job("workspace-1", "video")
    item = repository.create_item(job.id, "video", "video-key", {})
    repository.transition_item(item.id, "canceled")

    with pytest.raises(StorageError, match="terminal"):
        repository.transition_item(
            item.id,
            "succeeded",
            media_refs=[{"id": "media-1", "kind": "video", "uri": "video.mp4"}],
        )


def test_invalid_transition_is_rejected(repository):
    job = repository.create_job("workspace-1", "asset")
    item = repository.create_item(job.id, "image", "image-key", {})

    with pytest.raises(StorageError, match="invalid transition"):
        repository.transition_item(item.id, "succeeded", media_refs=[{"id": "m", "kind": "image", "uri": "image.png"}])
