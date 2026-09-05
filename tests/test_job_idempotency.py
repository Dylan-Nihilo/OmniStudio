from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.pool import StaticPool

from src.storage.db import create_engine, init_schema
from src.storage.job_repository import JobRepository
from src.storage.schema import JobItem, Workspace


def test_recovery_resumes_recoverable_items_and_fails_unknown_kind():
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

    repository = JobRepository(engine)
    job = repository.create_job("workspace-1", "mixed")
    recoverable = repository.create_item(job.id, "video", "video-key", {})
    unknown = repository.create_item(job.id, "provider_unknown", "unknown-key", {})
    repository.transition_item(recoverable.id, "processing", progress=0.6)
    repository.transition_item(unknown.id, "processing", progress=0.2)

    report = repository.recover_inflight("workspace-1", recoverable_kinds={"video"})

    assert report == {"resumed": 1, "failed": 1}
    with engine.connect() as connection:
        states = dict(connection.execute(select(JobItem.id, JobItem.status)).all())
    assert states[recoverable.id] == "processing"
    assert states[unknown.id] == "failed"
    engine.dispose()
