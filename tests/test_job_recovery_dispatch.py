from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.pool import StaticPool

from src.apps.comic_gen.job_adapters import ProductionJobAdapter
from src.storage.db import create_engine, init_schema
from src.storage.job_repository import JobRepository
from src.storage.schema import JobItemEvent, Workspace


def test_recover_replays_processing_item_and_records_recovery_event():
    engine = create_engine(":memory:", poolclass=StaticPool, connect_args={"check_same_thread": False})
    init_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            Workspace.__table__.insert(),
            {"id": "workspace-1", "name": "Acceptance", "created_at": 1.0, "updated_at": 1.0},
        )
    repository = JobRepository(engine)
    calls = []

    def recover(item):
        calls.append(item.id)
        return [{"id": "recovered-media", "kind": "video", "uri": "output/recovered.mp4"}]

    adapter = ProductionJobAdapter(repository, dispatchers={"video": recover})
    item = adapter.create("video", "workspace-1", None, None, {"shot_id": "shot-1"}, "video:recover:v1")
    repository.transition_item(item.id, "processing", progress=0.4)

    result = adapter.recover(item.id)

    assert result.status == "succeeded"
    assert calls == [item.id]
    with engine.connect() as connection:
        events = list(connection.execute(select(JobItemEvent.to_status).where(JobItemEvent.item_id == item.id)))
    assert [row[0] for row in events][-2:] == ["recovered", "succeeded"]
    engine.dispose()
