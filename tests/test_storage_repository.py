from __future__ import annotations

import hashlib
import json

import pytest
from sqlalchemy import select, update
from sqlalchemy.pool import StaticPool

from src.apps.comic_gen.models import Script as ScriptPayload
from src.apps.comic_gen.models import Series as SeriesPayload
from src.storage.db import create_engine, init_schema
from src.storage.auth_repository import AuthRepository
from src.storage.errors import StorageConflictError, StorageError
from src.storage.repository import SQLiteRepository
from src.storage.schema import Episode, Project, Script, Series


@pytest.fixture
def memory_engine():
    engine = create_engine(
        ":memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    init_schema(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def repository(memory_engine):
    return SQLiteRepository(memory_engine)


def make_script(
    script_id: str = "script-1",
    *,
    title: str = "Episode 1",
    original_text: str = "A short script",
    series_id: str | None = None,
    episode_number: int | None = None,
) -> ScriptPayload:
    return ScriptPayload(
        id=script_id,
        title=title,
        original_text=original_text,
        series_id=series_id,
        episode_number=episode_number,
        created_at=1_700_000_000.0,
        updated_at=1_700_000_001.0,
    )


def make_series(series_id: str = "series-1") -> SeriesPayload:
    return SeriesPayload(
        id=series_id,
        title="A Series",
        description="Series description",
        created_at=1_700_000_000.0,
        updated_at=1_700_000_001.0,
    )


def seed_collaboration_identities(engine) -> None:
    auth = AuthRepository(engine)
    for user_id, username in (("user-a", "usera"), ("user-b", "userb")):
        auth.create_user(
            {
                "id": user_id,
                "username": username,
                "username_normalized": username,
                "email": f"{username}@example.com",
                "email_normalized": f"{username}@example.com",
                "password_hash": "test",
            }
        )
    auth.create_workspace(
        {
            "id": "workspace-1",
            "owner_user_id": "user-a",
            "name": "Team",
            "slug": "default",
        }
    )


def test_script_round_trip(repository):
    script = make_script()

    repository.save_scripts({script.id: script})

    assert repository.load_scripts() == {script.id: script}


def test_script_edit_lease_is_single_writer_per_episode(repository, memory_engine):
    seed_collaboration_identities(memory_engine)
    script = make_script()
    repository.save_scripts({script.id: script})
    repository.assign_workspace_for_script(script.id, "workspace-1")

    first = repository.acquire_script_edit_lease(
        script.id,
        workspace_id="workspace-1",
        user_id="user-a",
        display_name="A",
        client_instance_id="browser-a",
        now=100.0,
        ttl_seconds=90,
    )
    blocked = repository.acquire_script_edit_lease(
        script.id,
        workspace_id="workspace-1",
        user_id="user-b",
        display_name="B",
        client_instance_id="browser-b",
        now=101.0,
        ttl_seconds=90,
    )
    parallel = make_script("script-2", title="Episode 2")
    repository.save_scripts({parallel.id: parallel})
    repository.assign_workspace_for_script(parallel.id, "workspace-1")
    second_episode = repository.acquire_script_edit_lease(
        parallel.id,
        workspace_id="workspace-1",
        user_id="user-b",
        display_name="B",
        client_instance_id="browser-b",
        now=101.0,
        ttl_seconds=90,
    )
    active = repository.get_active_script_edit_lease(script.id, now=101.0)
    expired = repository.get_active_script_edit_lease(script.id, now=191.0)

    assert first.acquired is True
    assert first.token
    assert blocked.acquired is False
    assert blocked.holder_display_name == "usera"
    assert active is not None
    assert active.client_instance_id == "browser-a"
    assert expired is None
    assert second_episode.acquired is True


def test_script_text_save_requires_live_lease_and_matching_revision(repository, memory_engine):
    seed_collaboration_identities(memory_engine)
    script = make_script()
    repository.save_scripts({script.id: script})
    repository.assign_workspace_for_script(script.id, "workspace-1")
    base_revision = repository.script_revision(script.id)
    lease = repository.acquire_script_edit_lease(
        script.id,
        workspace_id="workspace-1",
        user_id="user-a",
        display_name="A",
        client_instance_id="browser-a",
        now=100.0,
        ttl_seconds=90,
    )

    saved = repository.update_script_text_cas(
        script.id,
        text="A wrote this",
        expected_revision=base_revision,
        lease_token=lease.token,
        user_id="user-a",
        client_instance_id="browser-a",
        now=110.0,
    )
    stale = repository.update_script_text_cas(
        script.id,
        text="stale overwrite",
        expected_revision=base_revision,
        lease_token=lease.token,
        user_id="user-a",
        client_instance_id="browser-a",
        now=111.0,
    )
    expired = repository.update_script_text_cas(
        script.id,
        text="after expiry",
        expected_revision=saved.revision,
        lease_token=lease.token,
        user_id="user-a",
        client_instance_id="browser-a",
        now=191.0,
    )

    assert saved.status == "saved"
    assert saved.revision != base_revision
    assert stale.status == "conflict"
    assert expired.status == "lease_invalid"
    assert repository.load_scripts()[script.id].original_text == "A wrote this"


def test_script_edit_lease_heartbeat_and_release(repository, memory_engine):
    seed_collaboration_identities(memory_engine)
    script = make_script()
    repository.save_scripts({script.id: script})
    repository.assign_workspace_for_script(script.id, "workspace-1")
    lease = repository.acquire_script_edit_lease(
        script.id,
        workspace_id="workspace-1",
        user_id="user-a",
        display_name="A",
        client_instance_id="browser-a",
        now=100.0,
        ttl_seconds=90,
    )

    renewed_until = repository.heartbeat_script_edit_lease(
        script.id,
        user_id="user-a",
        client_instance_id="browser-a",
        lease_token=lease.token,
        now=150.0,
        ttl_seconds=90,
    )
    released = repository.release_script_edit_lease(
        script.id,
        user_id="user-a",
        client_instance_id="browser-a",
        lease_token=lease.token,
    )
    next_editor = repository.acquire_script_edit_lease(
        script.id,
        workspace_id="workspace-1",
        user_id="user-b",
        display_name="B",
        client_instance_id="browser-b",
        now=151.0,
        ttl_seconds=90,
    )

    assert renewed_until == 240.0
    assert released is True
    assert next_editor.acquired is True


def test_stale_pipeline_save_cannot_overwrite_newer_script_payload(memory_engine):
    first = SQLiteRepository(memory_engine)
    second = SQLiteRepository(memory_engine)
    script = make_script()
    first.save_scripts({script.id: script})
    stale_copy = second.load_scripts()[script.id]
    current_copy = first.load_scripts()[script.id]

    current_copy.original_text = "newer generation result"
    first.save_scripts({script.id: current_copy})
    stale_copy.original_text = "stale generation result"

    with pytest.raises(StorageConflictError):
        second.save_scripts({script.id: stale_copy})
    assert first.load_scripts()[script.id].original_text == "newer generation result"


def test_save_script_fills_standalone_envelopes(repository, memory_engine):
    script = make_script()
    repository.save_scripts({script.id: script})

    with memory_engine.connect() as connection:
        project = connection.execute(
            select(Project.id, Project.mode).where(Project.id == script.id)
        ).one()
        episode = connection.execute(
            select(Episode.id, Episode.project_id, Episode.series_id).where(
                Episode.id == script.id
            )
        ).one()

    assert project == (script.id, "standalone")
    assert episode == (script.id, script.id, None)


def test_save_script_fills_series_project_and_recovered_series(repository, memory_engine, caplog):
    script = make_script("episode-1", series_id="series-missing", episode_number=1)

    with caplog.at_level("WARNING"):
        repository.save_scripts({script.id: script})

    with memory_engine.connect() as connection:
        project = connection.execute(
            select(Project.id, Project.mode, Project.legacy_series_id).where(
                Project.id == script.series_id
            )
        ).one()
        episode = connection.execute(
            select(Episode.project_id, Episode.series_id).where(Episode.id == script.id)
        ).one()
        recovered = connection.execute(
            select(Series.id, Series.project_id, Series.title).where(
                Series.id == script.series_id
            )
        ).one()

    assert project == (script.series_id, "series", script.series_id)
    assert episode == (script.series_id, script.series_id)
    assert recovered == (
        script.series_id,
        script.series_id,
        "[Recovered series series-missing]",
    )
    assert "missing Series" in caplog.text


def test_load_scripts_rejects_corrupt_payload(repository, memory_engine):
    script = make_script()
    repository.save_scripts({script.id: script})

    with memory_engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA ignore_check_constraints=ON")
        connection.execute(
            update(Script.__table__)
            .where(Script.id == script.id)
            .values(payload_json="not-json")
        )
        connection.exec_driver_sql("PRAGMA ignore_check_constraints=OFF")

    with pytest.raises(StorageError, match="Corrupt scripts payload"):
        repository.load_scripts()


def test_save_scripts_flushes_changed_payload(repository, memory_engine):
    script = make_script()
    repository.save_scripts({script.id: script})
    changed = script.model_copy(update={"title": "Updated title", "updated_at": 2_000_000_000.0})

    repository.save_scripts({changed.id: changed})

    loaded = repository.load_scripts()[script.id]
    assert loaded.title == "Updated title"
    with memory_engine.connect() as connection:
        row = connection.execute(
            select(Script.payload_json, Script.payload_sha256).where(Script.id == script.id)
        ).one()
    assert json.loads(row.payload_json)["title"] == "Updated title"
    expected_hash = hashlib.sha256(
        f"{script.id}{row.payload_json}".encode("utf-8")
    ).hexdigest()
    assert row.payload_sha256 == expected_hash


def test_save_scripts_rolls_back_when_a_later_upsert_fails(repository, memory_engine, monkeypatch):
    first = make_script("first")
    second = make_script("second")
    original = repository._upsert_script

    def fail_for_second(connection, script_id, payload, payload_json, payload_sha256):
        if script_id == "second":
            raise RuntimeError("injected failure")
        return original(connection, script_id, payload, payload_json, payload_sha256)

    monkeypatch.setattr(repository, "_upsert_script", fail_for_second)

    with pytest.raises(StorageError, match="transaction rolled back"):
        repository.save_scripts({first.id: first, second.id: second})

    with memory_engine.connect() as connection:
        assert connection.execute(select(Script.id)).all() == []
        assert connection.execute(select(Project.id)).all() == []
        assert connection.execute(select(Episode.id)).all() == []


def test_invalid_id_is_rejected_without_partial_write(repository, memory_engine):
    first = make_script("first")
    invalid = make_script("payload-id")

    with pytest.raises(StorageError, match="does not match payload id"):
        repository.save_scripts({first.id: first, "wrong-key": invalid})

    with memory_engine.connect() as connection:
        assert connection.execute(select(Script.id)).all() == []


def test_delete_script_cleans_standalone_envelope_but_not_series_project(repository, memory_engine):
    standalone = make_script("standalone")
    series = make_series()
    episode = make_script("episode-1", series_id=series.id, episode_number=1)
    repository.save_bundle({standalone.id: standalone, episode.id: episode}, {series.id: series})

    repository.delete_script(standalone.id)
    with memory_engine.connect() as connection:
        assert connection.execute(select(Project.id).where(Project.id == standalone.id)).first() is None
        assert connection.execute(select(Episode.id).where(Episode.id == standalone.id)).first() is None

    repository.delete_script(episode.id)
    with memory_engine.connect() as connection:
        assert connection.execute(select(Project.id).where(Project.id == series.id)).first() is not None
        assert connection.execute(select(Series.id).where(Series.id == series.id)).first() is not None


def test_delete_series_preserves_project_and_scripts_and_detaches_episodes(repository, memory_engine):
    series = make_series()
    episode = make_script("episode-1", series_id=series.id, episode_number=1)
    repository.save_bundle({episode.id: episode}, {series.id: series})

    repository.delete_series(series.id)

    assert repository.load_scripts()[episode.id] == episode
    with memory_engine.connect() as connection:
        assert connection.execute(select(Series.id).where(Series.id == series.id)).first() is None
        assert connection.execute(select(Project.id).where(Project.id == series.id)).first() is not None
        assert connection.execute(
            select(Episode.series_id).where(Episode.id == episode.id)
        ).scalar_one() is None
