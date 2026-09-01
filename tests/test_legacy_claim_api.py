from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import select

from src.apps.comic_gen.auth.dependencies import get_current_user
from src.apps.comic_gen.models import Script
from src.storage.legacy_claim import LegacyClaimService
from src.storage.repository import SQLiteRepository
from src.storage.schema import Session
from tests.auth_test_helpers import make_auth_app, make_client


def _setup_payload():
    return {
        "username": "owner",
        "email": "owner@example.com",
        "password": "correct horse battery staple",
    }


@pytest.fixture
def claim_api(tmp_path: Path):
    app, engine, _ = make_auth_app(tmp_path)
    projects_path = tmp_path / "projects.json"
    series_path = tmp_path / "series.json"
    script = Script(
        id="legacy-project",
        title="Legacy Project",
        original_text="Legacy source",
        merged_video_url="/files/output/video/legacy.mp4",
        created_at=1_700_000_000.0,
        updated_at=1_700_000_001.0,
    )
    projects_path.write_text(
        json.dumps({script.id: script.model_dump(mode="json")}),
        encoding="utf-8",
    )
    SQLiteRepository(engine).save_bundle({script.id: script}, {})
    app.state.legacy_claim_service = LegacyClaimService(
        engine,
        db_path=tmp_path / "auth.db",
        projects_path=projects_path,
        series_path=series_path,
    )
    with make_client(app, local=True) as client:
        setup = client.post("/auth/setup", json=_setup_payload())
        assert setup.status_code == 201, setup.text
        yield client, engine, setup.json()
    engine.dispose()


def test_legacy_claim_status_requires_authentication(claim_api):
    client, _, _ = claim_api
    client.cookies.clear()

    response = client.get("/auth/legacy-claim/status")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_SESSION_INVALID"


def test_legacy_claim_routes_require_workspace_owner(claim_api):
    client, engine, auth = claim_api
    with engine.connect() as connection:
        session_id = connection.scalar(select(Session.id))
    context = client.app.state.auth_service.get_current_user(
        user_id=auth["user"]["id"],
        session_id=session_id,
    )
    context.membership.role = "member"
    client.app.dependency_overrides[get_current_user] = lambda: context

    response = client.get("/auth/legacy-claim/status")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"
    client.app.dependency_overrides.clear()


def test_owner_can_preview_apply_and_rollback_legacy_data(claim_api):
    client, _, _ = claim_api

    status = client.get("/auth/legacy-claim/status")
    preview = client.post("/auth/legacy-claim/preview")

    assert status.status_code == 200
    assert status.headers["cache-control"] == "no-store"
    assert status.json()["state"] == "ready"
    assert preview.status_code == 200
    assert preview.json()["summary"] == {
        "projects": 1,
        "series": 0,
        "media": 1,
        "conflicts": 0,
    }

    claimed = client.post(
        "/auth/legacy-claim/apply",
        json={"expected_source_sha256": preview.json()["source_sha256"]},
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["state"] == "claimed"
    assert claimed.json()["rollback_available"] is True

    rolled_back = client.post("/auth/legacy-claim/rollback")
    repeated = client.post("/auth/legacy-claim/rollback")
    assert rolled_back.status_code == 200, rolled_back.text
    assert rolled_back.json()["state"] == "rolled_back"
    assert repeated.status_code == 200
    assert repeated.json()["idempotent"] is True


def test_apply_requires_matching_preview_hash(claim_api):
    client, _, _ = claim_api

    response = client.post(
        "/auth/legacy-claim/apply",
        json={"expected_source_sha256": "0" * 64},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "LEGACY_CLAIM_SOURCE_CHANGED"


def test_mutating_claim_route_requires_csrf(claim_api):
    client, _, _ = claim_api
    csrf = client.cookies.get("omni_studio_csrf")
    client.cookies.set("omni_studio_csrf", csrf)

    response = client.request(
        "POST",
        "/auth/legacy-claim/preview",
        headers={"Origin": "http://testserver", "X-CSRF-Token": "invalid"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_CSRF_FAILED"
