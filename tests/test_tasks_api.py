from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from src.apps.comic_gen.auth.csrf import issue_csrf_token
from src.apps.comic_gen.auth.settings import AuthSettings
from src.apps.comic_gen.auth.service import AuthService
from src.storage.auth_repository import AuthRepository
from src.storage.db import create_engine, init_schema
from src.storage.job_repository import JobRepository
from src.storage.schema import Episode, Project, User, Workspace


def _configure_full_app(tmp_path, monkeypatch, *, workspace_id: str = "workspace-a"):
    from src.apps.comic_gen import api as api_module

    engine = create_engine(tmp_path / f"{workspace_id}.db")
    init_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            User.__table__.insert(),
            {
                "id": "user-a",
                "username": "owner",
                "username_normalized": "owner",
                "email": "owner@example.com",
                "email_normalized": "owner@example.com",
                "password_hash": "test-hash",
                "created_at": 1.0,
                "updated_at": 1.0,
                "metadata_json": "{}",
            },
        )
        connection.execute(
            Workspace.__table__.insert(),
            {
                "id": workspace_id,
                "owner_user_id": "user-a",
                "name": "Task API Workspace",
                "slug": f"slug-{workspace_id}",
                "created_at": 1.0,
                "updated_at": 1.0,
                "metadata_json": "{}",
            },
        )
        connection.execute(
            Project.__table__.insert(),
            {
                "id": "project-a",
                "workspace_id": workspace_id,
                "title": "Task API Project",
                "description": "",
                "mode": "standalone",
                "created_at": 1.0,
                "updated_at": 1.0,
                "metadata_json": "{}",
            },
        )
        connection.execute(
            Episode.__table__.insert(),
            {
                "id": "episode-1",
                "project_id": "project-a",
                "title": "Episode 1",
                "episode_number": 1,
                "created_at": 1.0,
                "updated_at": 1.0,
                "metadata_json": "{}",
            },
        )

    settings = AuthSettings(
        signing_secret="test-signing-secret-012345678901234567890123456789",
        allowed_origins=("http://testserver",),
        app_env="test",
        allow_test_bypass=True,
    )
    service = AuthService(AuthRepository(engine), settings)
    previous = {
        "auth_service": api_module.app.state.auth_service,
        "auth_settings": api_module.app.state.auth_settings,
        "storage_engine": api_module.app.state.storage_engine,
        "test_auth_context": getattr(api_module.app.state, "test_auth_context", None),
        "pipeline": api_module.pipeline,
    }
    api_module.app.state.auth_service = service
    api_module.app.state.auth_settings = settings
    api_module.app.state.storage_engine = engine
    api_module.app.state.test_auth_context = SimpleNamespace(
        user=SimpleNamespace(id="user-a"),
        workspace=SimpleNamespace(id=workspace_id),
        session=SimpleNamespace(id="session-a"),
        membership=SimpleNamespace(role="owner"),
    )
    monkeypatch.setattr(api_module, "pipeline", SimpleNamespace(repository=None))
    return api_module.app, engine, previous, api_module, settings


def _restore_full_app(api_module, engine, previous):
    api_module.app.state.auth_service = previous["auth_service"]
    api_module.app.state.auth_settings = previous["auth_settings"]
    api_module.app.state.storage_engine = previous["storage_engine"]
    api_module.app.state.test_auth_context = previous["test_auth_context"]
    api_module.pipeline = previous["pipeline"]
    engine.dispose()


def _client(app, settings):
    client = TestClient(app, client=("127.0.0.1", 41000), raise_server_exceptions=False)
    csrf = issue_csrf_token("session-a", settings.signing_secret)
    client.cookies.set("omni_studio_csrf", csrf)
    client.headers.update({"Origin": "http://testserver", "X-CSRF-Token": csrf})
    return client


def _seed_job(
    engine,
    workspace_id: str = "workspace-a",
    *,
    project_id: str = "project-a",
    episode_id: str = "episode-1",
):
    repository = JobRepository(engine)
    job = repository.create_job(workspace_id, "video", project_id=project_id, episode_id=episode_id)
    processing = repository.create_item(job.id, "video", f"video:{episode_id}:shot-1")
    repository.transition_item(processing.id, "processing", progress=0.4)
    failed = repository.create_item(job.id, "audio", f"audio:{episode_id}:shot-1")
    repository.transition_item(failed.id, "failed", error={"code": "PROVIDER_TIMEOUT", "message": "provider timed out"})
    return repository, job, processing, failed


def test_tasks_list_filters_by_workspace_and_returns_paginated_job_summary(tmp_path, monkeypatch):
    app, engine, previous, api_module, settings = _configure_full_app(tmp_path, monkeypatch)
    try:
        _repository, job, _processing, _failed = _seed_job(engine)
        with _client(app, settings) as client:
            response = client.get("/tasks", params={"status": "processing", "page": 1, "page_size": 10})

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["page"] == 1
        assert payload["total"] == 1
        assert payload["items"][0]["id"] == job.id
        assert payload["items"][0]["total"] == 2
        assert payload["items"][0]["failed"] == 1
        assert payload["items"][0]["status"] == "processing"
    finally:
        _restore_full_app(api_module, engine, previous)


def test_task_detail_includes_item_state_and_status_event_history(tmp_path, monkeypatch):
    app, engine, previous, api_module, settings = _configure_full_app(tmp_path, monkeypatch)
    try:
        _repository, job, processing, _failed = _seed_job(engine)
        with _client(app, settings) as client:
            response = client.get(f"/tasks/{job.id}")

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["job"]["id"] == job.id
        item = next(item for item in payload["job"]["items"] if item["id"] == processing.id)
        assert item["status"] == "processing"
        assert [event["to_status"] for event in payload["events"] if event["item_id"] == processing.id] == ["processing"]
    finally:
        _restore_full_app(api_module, engine, previous)


def test_task_cancel_only_marks_non_terminal_items_canceled(tmp_path, monkeypatch):
    app, engine, previous, api_module, settings = _configure_full_app(tmp_path, monkeypatch)
    try:
        repository, job, processing, failed = _seed_job(engine)
        pending = repository.create_item(job.id, "asset", "asset:episode-1:shot-1")
        with _client(app, settings) as client:
            response = client.post(f"/tasks/{job.id}/cancel")

        assert response.status_code == 200, response.text
        statuses = {item["id"]: item["status"] for item in response.json()["items"]}
        assert statuses[processing.id] == "canceled"
        assert statuses[pending.id] == "canceled"
        assert statuses[failed.id] == "failed"
    finally:
        _restore_full_app(api_module, engine, previous)


def test_task_retry_creates_pending_items_linked_to_failed_items(tmp_path, monkeypatch):
    app, engine, previous, api_module, settings = _configure_full_app(tmp_path, monkeypatch)
    try:
        _repository, job, _processing, failed = _seed_job(engine)
        with _client(app, settings) as client:
            response = client.post(f"/tasks/{job.id}/retry")

        assert response.status_code == 200, response.text
        retried = [item for item in response.json()["items"] if item.get("retry_of") == failed.id]
        assert len(retried) == 1
        assert retried[0]["status"] == "pending"

        with _client(app, settings) as client:
            repeated = client.post(f"/tasks/{job.id}/retry")
        repeated_retried = [item for item in repeated.json()["items"] if item.get("retry_of") == failed.id]
        assert len(repeated_retried) == 1
    finally:
        _restore_full_app(api_module, engine, previous)


def test_task_routes_hide_jobs_from_another_workspace_and_expose_summary(tmp_path, monkeypatch):
    app, engine, previous, api_module, settings = _configure_full_app(tmp_path, monkeypatch)
    try:
        with engine.begin() as connection:
            connection.execute(
                Workspace.__table__.insert(),
                {
                    "id": "workspace-other",
                    "owner_user_id": "user-a",
                    "name": "Other",
                    "slug": "other",
                    "created_at": 1.0,
                    "updated_at": 1.0,
                    "metadata_json": "{}",
                },
            )
            connection.execute(
                Project.__table__.insert(),
                {
                    "id": "project-other",
                    "workspace_id": "workspace-other",
                    "title": "Other Project",
                    "description": "",
                    "mode": "standalone",
                    "created_at": 1.0,
                    "updated_at": 1.0,
                    "metadata_json": "{}",
                },
            )
            connection.execute(
                Episode.__table__.insert(),
                {
                    "id": "episode-other",
                    "project_id": "project-other",
                    "title": "Other Episode",
                    "episode_number": 1,
                    "created_at": 1.0,
                    "updated_at": 1.0,
                    "metadata_json": "{}",
                },
            )
        _repository, foreign_job, _processing, _failed = _seed_job(
            engine,
            "workspace-other",
            project_id="project-other",
            episode_id="episode-other",
        )
    except Exception:
        # The foreign-key row must exist before seeding a job; this branch is
        # intentionally unreachable and keeps the setup failure explicit.
        raise
    try:
        with _client(app, settings) as client:
            hidden = client.get(f"/tasks/{foreign_job.id}")
            summary = client.get("/tasks/summary", params={"project_id": "project-a", "episode_id": "episode-1"})

        assert hidden.status_code == 404
        assert summary.status_code == 200, summary.text
        assert summary.json()["total"] == 0
    finally:
        _restore_full_app(api_module, engine, previous)
