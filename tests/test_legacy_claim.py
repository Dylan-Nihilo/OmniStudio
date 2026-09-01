from __future__ import annotations

import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from sqlalchemy import func, select

from src.apps.comic_gen.models import Script
from src.storage.db import create_engine, init_schema
from src.storage.legacy_claim import LegacyClaimError, LegacyClaimService
from src.storage.migration import apply as import_legacy
from src.storage.schema import LegacyClaimBatch, Project, User, Workspace


def _script(script_id: str, *, media_url: str | None = None) -> Script:
    return Script(
        id=script_id,
        title=f"Project {script_id}",
        original_text="A legacy script",
        merged_video_url=media_url,
        created_at=1_700_000_000.0,
        updated_at=1_700_000_001.0,
    )


def _write_projects(path: Path, scripts: list[Script]) -> bytes:
    raw = json.dumps(
        {item.id: item.model_dump(mode="json") for item in scripts},
        ensure_ascii=False,
    ).encode("utf-8")
    path.write_bytes(raw)
    return raw


def _seed_owner(engine, *, user_id: str = "owner-1", workspace_id: str = "workspace-1"):
    now = time.time()
    with engine.begin() as connection:
        connection.execute(
            User.__table__.insert(),
            {
                "id": user_id,
                "username": user_id,
                "username_normalized": user_id,
                "email": f"{user_id}@example.com",
                "email_normalized": f"{user_id}@example.com",
                "display_name": user_id,
                "password_hash": "not-used-by-this-test",
                "created_at": now,
                "updated_at": now,
                "metadata_json": "{}",
            },
        )
        connection.execute(
            Workspace.__table__.insert(),
            {
                "id": workspace_id,
                "owner_user_id": user_id,
                "name": "Owner Workspace",
                "slug": workspace_id,
                "created_at": now,
                "updated_at": now,
                "metadata_json": "{}",
            },
        )


@pytest.fixture
def claim_fixture(tmp_path: Path):
    projects_path = tmp_path / "projects.json"
    series_path = tmp_path / "series.json"
    db_path = tmp_path / "omni_studio.db"
    source_bytes = _write_projects(
        projects_path,
        [_script("project-1", media_url="/files/output/video/final.mp4")],
    )
    import_legacy(projects_path, series_path, db_path)
    engine = create_engine(db_path)
    init_schema(engine)
    _seed_owner(engine)
    service = LegacyClaimService(
        engine,
        db_path=db_path,
        projects_path=projects_path,
        series_path=series_path,
    )
    try:
        yield service, engine, projects_path, source_bytes
    finally:
        engine.dispose()


def test_preview_reports_summary_without_writing_source_or_claim_batch(claim_fixture):
    service, engine, projects_path, source_bytes = claim_fixture

    report = service.preview(user_id="owner-1", workspace_id="workspace-1")

    assert report["state"] == "ready"
    assert report["source_sha256"]
    assert report["summary"] == {
        "projects": 1,
        "series": 0,
        "media": 1,
        "conflicts": 0,
    }
    assert report["rollback_available"] is False
    assert projects_path.read_bytes() == source_bytes
    with engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(LegacyClaimBatch)) == 0
        assert connection.scalar(select(Project.workspace_id)) is None


def test_apply_claims_exact_preview_mapping_and_is_idempotent(claim_fixture):
    service, engine, _, _ = claim_fixture
    preview = service.preview(user_id="owner-1", workspace_id="workspace-1")

    first = service.apply(
        user_id="owner-1",
        workspace_id="workspace-1",
        expected_source_sha256=preview["source_sha256"],
    )
    second = service.apply(
        user_id="owner-1",
        workspace_id="workspace-1",
        expected_source_sha256=preview["source_sha256"],
    )

    assert first["state"] == "claimed"
    assert first["idempotent"] is False
    assert first["batch"]["project_ids"] == ["project-1"]
    assert second["state"] == "claimed"
    assert second["idempotent"] is True
    assert second["batch"]["id"] == first["batch"]["id"]
    with engine.connect() as connection:
        assert connection.scalar(select(Project.workspace_id)) == "workspace-1"
        assert connection.scalar(select(func.count()).select_from(LegacyClaimBatch)) == 1


def test_apply_rejects_source_hash_drift_without_claiming(claim_fixture):
    service, engine, projects_path, _ = claim_fixture
    preview = service.preview(user_id="owner-1", workspace_id="workspace-1")
    _write_projects(projects_path, [_script("project-1"), _script("project-2")])

    with pytest.raises(LegacyClaimError) as caught:
        service.apply(
            user_id="owner-1",
            workspace_id="workspace-1",
            expected_source_sha256=preview["source_sha256"],
        )

    assert caught.value.code == "LEGACY_CLAIM_SOURCE_CHANGED"
    with engine.connect() as connection:
        assert connection.scalar(select(Project.workspace_id)) is None
        assert connection.scalar(select(func.count()).select_from(LegacyClaimBatch)) == 0


def test_apply_conflict_leaves_all_ownerless_projects_unchanged(tmp_path: Path):
    projects_path = tmp_path / "projects.json"
    series_path = tmp_path / "series.json"
    db_path = tmp_path / "omni_studio.db"
    _write_projects(projects_path, [_script("project-1"), _script("project-2")])
    import_legacy(projects_path, series_path, db_path)
    engine = create_engine(db_path)
    init_schema(engine)
    _seed_owner(engine)
    _seed_owner(engine, user_id="owner-2", workspace_id="workspace-2")
    with engine.begin() as connection:
        connection.execute(
            Project.__table__.update()
            .where(Project.id == "project-2")
            .values(workspace_id="workspace-2")
        )
    service = LegacyClaimService(
        engine,
        db_path=db_path,
        projects_path=projects_path,
        series_path=series_path,
    )
    preview = service.preview(user_id="owner-1", workspace_id="workspace-1")

    with pytest.raises(LegacyClaimError) as caught:
        service.apply(
            user_id="owner-1",
            workspace_id="workspace-1",
            expected_source_sha256=preview["source_sha256"],
        )

    assert caught.value.code == "LEGACY_CLAIM_OWNERSHIP_CONFLICT"
    with engine.connect() as connection:
        rows = dict(connection.execute(select(Project.id, Project.workspace_id)).all())
        assert rows == {"project-1": None, "project-2": "workspace-2"}
        assert connection.scalar(select(func.count()).select_from(LegacyClaimBatch)) == 0
    engine.dispose()


def test_rollback_only_releases_the_completed_batch_and_is_idempotent(claim_fixture):
    service, engine, _, _ = claim_fixture
    preview = service.preview(user_id="owner-1", workspace_id="workspace-1")
    claimed = service.apply(
        user_id="owner-1",
        workspace_id="workspace-1",
        expected_source_sha256=preview["source_sha256"],
    )

    first = service.rollback(user_id="owner-1", workspace_id="workspace-1")
    second = service.rollback(user_id="owner-1", workspace_id="workspace-1")

    assert first["state"] == "rolled_back"
    assert first["idempotent"] is False
    assert first["batch"]["id"] == claimed["batch"]["id"]
    assert second["state"] == "rolled_back"
    assert second["idempotent"] is True
    with engine.connect() as connection:
        assert connection.scalar(select(Project.workspace_id)) is None
        assert connection.scalar(select(LegacyClaimBatch.status)) == "rolled_back"


def test_concurrent_apply_creates_one_batch(claim_fixture):
    service, engine, _, _ = claim_fixture
    source_hash = service.preview(
        user_id="owner-1", workspace_id="workspace-1"
    )["source_sha256"]

    def claim():
        return service.apply(
            user_id="owner-1",
            workspace_id="workspace-1",
            expected_source_sha256=source_hash,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: claim(), range(2)))

    assert {item["state"] for item in results} == {"claimed"}
    assert sorted(item["idempotent"] for item in results) == [False, True]
    with engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(LegacyClaimBatch)) == 1


def test_invalid_legacy_json_returns_blocked_preview(tmp_path: Path):
    projects_path = tmp_path / "projects.json"
    projects_path.write_text('{"broken":', encoding="utf-8")
    db_path = tmp_path / "omni_studio.db"
    engine = create_engine(db_path)
    init_schema(engine)
    service = LegacyClaimService(
        engine,
        db_path=db_path,
        projects_path=projects_path,
        series_path=tmp_path / "series.json",
    )

    report = service.preview(user_id="owner-1", workspace_id="workspace-1")

    assert report["state"] == "blocked"
    assert report["summary"]["conflicts"] == 1
    assert report["diagnostics"][0]["type"] == "invalid_source"
    assert "A legacy script" not in json.dumps(report)
    engine.dispose()


def test_claimed_batch_remains_rollbackable_when_source_becomes_invalid(claim_fixture):
    service, engine, projects_path, _ = claim_fixture
    preview = service.preview(user_id="owner-1", workspace_id="workspace-1")
    service.apply(
        user_id="owner-1",
        workspace_id="workspace-1",
        expected_source_sha256=preview["source_sha256"],
    )
    projects_path.write_text('{"broken":', encoding="utf-8")

    status = service.status(user_id="owner-1", workspace_id="workspace-1")
    rolled_back = service.rollback(user_id="owner-1", workspace_id="workspace-1")

    assert status["state"] == "claimed"
    assert status["rollback_available"] is True
    assert status["summary"]["conflicts"] == 1
    assert rolled_back["state"] == "rolled_back"
    with engine.connect() as connection:
        assert connection.scalar(select(Project.workspace_id)) is None


def test_preview_blocks_duplicate_project_titles_before_workspace_assignment(tmp_path: Path):
    projects_path = tmp_path / "projects.json"
    series_path = tmp_path / "series.json"
    db_path = tmp_path / "omni_studio.db"
    first = _script("project-1")
    second = _script("project-2")
    first.title = "Same title"
    second.title = "Same title"
    _write_projects(projects_path, [first, second])
    import_legacy(projects_path, series_path, db_path)
    engine = create_engine(db_path)
    init_schema(engine)
    _seed_owner(engine)
    service = LegacyClaimService(
        engine,
        db_path=db_path,
        projects_path=projects_path,
        series_path=series_path,
    )

    report = service.preview(user_id="owner-1", workspace_id="workspace-1")

    assert report["state"] == "blocked"
    assert report["summary"]["conflicts"] == 1
    assert report["diagnostics"][0]["type"] == "duplicate_workspace_title"
    with engine.connect() as connection:
        assert set(connection.execute(select(Project.workspace_id)).scalars()) == {None}
    engine.dispose()


def test_preview_source_hash_matches_unchanged_projects_file(claim_fixture):
    service, _, _, source_bytes = claim_fixture

    report = service.preview(user_id="owner-1", workspace_id="workspace-1")

    assert report["source_files"][0]["sha256"] == hashlib.sha256(source_bytes).hexdigest()
