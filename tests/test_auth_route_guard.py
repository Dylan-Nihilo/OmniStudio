from __future__ import annotations

import json
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from src.apps.comic_gen.auth.settings import AuthSettings
from src.apps.comic_gen.auth.service import AuthService
from src.apps.comic_gen.auth.tokens import issue_access_token
from src.storage.auth_repository import AuthRepository
from src.storage.db import create_engine, init_schema
from tests.auth_test_helpers import make_auth_app, make_client


def setup_owner(client):
    return client.post(
        "/auth/setup",
        json={
            "username": "owner",
            "email": "owner@example.com",
            "password": "correct horse battery staple",
        },
    )


def test_me_without_token_is_unauthorized(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        response = client.get("/auth/me")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTH_SESSION_INVALID"
    engine.dispose()


def test_me_with_invalid_or_expired_token_is_unauthorized(tmp_path):
    app, engine, service = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup = setup_owner(client)
        assert setup.status_code == 201
        client.cookies.clear()
        invalid = client.get("/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
        assert invalid.status_code == 401

        expired = issue_access_token(
            "missing-user",
            "missing-session",
            service.settings.signing_secret,
            now=time.time() - 3600,
            ttl_seconds=900,
            issuer=service.settings.issuer,
            audience=service.settings.audience,
        )
        response = client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTH_SESSION_INVALID"
    engine.dispose()


def test_cookie_and_header_mismatch_is_bad_request(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup = setup_owner(client)
        assert setup.status_code == 201
        cookie_token = setup.json()["access_token"]
        response = client.get("/auth/me", headers={"Authorization": "Bearer different-token"})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "AUTH_AMBIGUOUS_CREDENTIALS"
        assert cookie_token
    engine.dispose()


def test_cookie_and_bearer_access_are_supported(tmp_path):
    app, engine, _ = make_auth_app(tmp_path)
    with make_client(app, local=True) as client:
        setup = setup_owner(client)
        assert setup.status_code == 201
        cookie_me = client.get("/auth/me")
        assert cookie_me.status_code == 200
        token = setup.json()["access_token"]
        client.cookies.clear()
        bearer_me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert bearer_me.status_code == 200
    engine.dispose()


def test_business_route_requires_auth_and_public_endpoints_remain_open(tmp_path):
    # Exercise the real application-boundary middleware rather than only the
    # auth router fixture.  Replace its singleton auth service with an isolated
    # test database so the global app does not share state with other tests.
    from src.apps.comic_gen.api import app as full_app

    engine = create_engine(tmp_path / "route-guard.db")
    init_schema(engine)
    settings = AuthSettings(
        signing_secret="test-signing-secret-012345678901234567890123456789",
        access_ttl_seconds=900,
        refresh_ttl_seconds=7 * 86400,
        cookie_secure=False,
        allowed_origins=("http://testserver",),
        app_env="test",
    )
    service = AuthService(AuthRepository(engine), settings)
    previous_service = full_app.state.auth_service
    previous_settings = full_app.state.auth_settings
    full_app.state.auth_service = service
    full_app.state.auth_settings = settings
    try:
        with TestClient(full_app, client=("127.0.0.1", 41000), raise_server_exceptions=False) as client:
            health = client.get("/health")
            assert health.status_code == 200
            assert health.headers["X-Content-Type-Options"] == "nosniff"

            setup_status = client.get("/auth/setup-status")
            assert setup_status.status_code == 200
            csrf = client.cookies.get("lumenx_csrf")
            setup = client.post(
                "/auth/setup",
                headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
                json={
                    "username": "owner",
                    "email": "owner@example.com",
                    "password": "correct horse battery staple",
                },
            )
            assert setup.status_code == 201, setup.text

            client.cookies.clear()
            unauthenticated = client.get("/projects/")
            assert unauthenticated.status_code == 401
            assert unauthenticated.json()["error"]["code"] == "AUTH_SESSION_INVALID"

            client.get("/auth/setup-status")
            csrf = client.cookies.get("lumenx_csrf")
            login = client.post(
                "/auth/login",
                headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
                json={"identifier": "owner", "password": "correct horse battery staple"},
            )
            assert login.status_code == 200, login.text
            authenticated = client.get("/projects/")
            assert authenticated.status_code == 200, authenticated.text
    finally:
        full_app.state.auth_service = previous_service
        full_app.state.auth_settings = previous_settings
        engine.dispose()


def test_resource_path_resolves_script_and_series_workspace():
    from src.apps.comic_gen.api import _workspace_for_resource_path

    class Repository:
        def workspace_for_script(self, resource_id):
            return "workspace-script"

        def workspace_for_project(self, resource_id):
            return "workspace-project"

        def workspace_for_series(self, resource_id):
            return "workspace-series"

    repository = Repository()
    assert _workspace_for_resource_path("/projects/script-1", repository) == "workspace-script"
    assert _workspace_for_resource_path("/projects/project-1/episodes", repository) == "workspace-project"
    assert _workspace_for_resource_path("/projects/domain", repository) is None
    assert _workspace_for_resource_path("/series/series-1/episodes", repository) == "workspace-series"
    assert _workspace_for_resource_path("/projects/", repository) is None
    assert _workspace_for_resource_path("/health", repository) is None


def test_series_list_is_filtered_to_authenticated_workspace(monkeypatch):
    from src.apps.comic_gen import api as api_module

    class Repository:
        def workspace_for_series(self, resource_id):
            return {"series-a": "workspace-1", "series-b": "workspace-2"}[resource_id]

    class Pipeline:
        repository = Repository()

        @staticmethod
        def list_series():
            class SeriesItem:
                def __init__(self, series_id):
                    self.id = series_id

                def model_dump(self):
                    return {"id": self.id}

            return [SeriesItem("series-a"), SeriesItem("series-b")]

    request = SimpleNamespace(
        state=SimpleNamespace(
            auth_context=SimpleNamespace(workspace=SimpleNamespace(id="workspace-1")),
        ),
    )
    monkeypatch.setattr(api_module, "pipeline", Pipeline())

    response = api_module.list_series(request)

    assert response.status_code == 200
    assert [item["id"] for item in json.loads(response.body)] == ["series-a"]


def test_domain_project_list_is_filtered_to_authenticated_workspace(monkeypatch):
    from src.apps.comic_gen import api as api_module

    class Repository:
        @staticmethod
        def load_projects():
            def project(project_id, workspace_id):
                return SimpleNamespace(
                    id=project_id,
                    title=project_id,
                    mode="standalone",
                    workspace_id=workspace_id,
                    episode_ids=[project_id],
                    created_at=1.0,
                    updated_at=2.0,
                )

            return {
                "project-a": project("project-a", "workspace-1"),
                "project-b": project("project-b", "workspace-2"),
                "project-unowned": project("project-unowned", None),
            }

    class Pipeline:
        repository = Repository()

    request = SimpleNamespace(
        state=SimpleNamespace(
            auth_context=SimpleNamespace(workspace=SimpleNamespace(id="workspace-1")),
        ),
    )
    monkeypatch.setattr(api_module, "pipeline", Pipeline())

    response = api_module.list_domain_projects(request)

    assert response.status_code == 200
    assert [item["id"] for item in json.loads(response.body)] == ["project-a"]


def test_auth_rejection_keeps_cors_headers_for_allowed_browser_origin(tmp_path, monkeypatch):
    """A browser must be able to read an auth error instead of seeing a CORS network error."""
    monkeypatch.setenv("LUMENX_AUTH_SIGNING_SECRET", "test-signing-secret-012345678901234567890123456789")
    from src.apps.comic_gen.api import app as full_app

    engine = create_engine(tmp_path / "cors-route-guard.db")
    init_schema(engine)
    settings = AuthSettings(
        signing_secret="test-signing-secret-012345678901234567890123456789",
        allowed_origins=("http://localhost:3008",),
        app_env="test",
    )
    service = AuthService(AuthRepository(engine), settings)
    previous_service = full_app.state.auth_service
    previous_settings = full_app.state.auth_settings
    full_app.state.auth_service = service
    full_app.state.auth_settings = settings
    try:
        with TestClient(full_app, client=("127.0.0.1", 41000), raise_server_exceptions=False) as client:
            response = client.post(
                "/series",
                headers={"Origin": "http://localhost:3008"},
                json={"title": "CORS auth rejection"},
            )
            assert response.status_code == 428
            assert response.headers["access-control-allow-origin"] == "http://localhost:3008"
            assert response.headers["access-control-allow-credentials"] == "true"
    finally:
        full_app.state.auth_service = previous_service
        full_app.state.auth_settings = previous_settings
        engine.dispose()


def test_test_auth_bypass_is_rejected_outside_test_environment(tmp_path):
    with pytest.raises(RuntimeError, match="APP_ENV=test"):
        AuthSettings.from_env(
            environ={
                "APP_ENV": "production",
                "LUMENX_AUTH_TEST_BYPASS": "1",
                "LUMENX_AUTH_SIGNING_SECRET": "s" * 32,
            },
            config_path=tmp_path / "config.json",
        )


def test_test_auth_bypass_can_inject_identity_only_in_test_environment(tmp_path):
    from src.apps.comic_gen.api import app as full_app

    engine = create_engine(tmp_path / "route-bypass.db")
    init_schema(engine)
    settings = AuthSettings(
        signing_secret="test-signing-secret-012345678901234567890123456789",
        allowed_origins=("http://testserver",),
        app_env="test",
        allow_test_bypass=True,
    )
    service = AuthService(AuthRepository(engine), settings)
    previous_service = full_app.state.auth_service
    previous_settings = full_app.state.auth_settings
    previous_context = getattr(full_app.state, "test_auth_context", None)
    had_context = hasattr(full_app.state, "test_auth_context")
    full_app.state.auth_service = service
    full_app.state.auth_settings = settings
    full_app.state.test_auth_context = SimpleNamespace(
        user=SimpleNamespace(id="test-user"),
        workspace=SimpleNamespace(id="test-workspace"),
        session=SimpleNamespace(id="test-session"),
    )
    try:
        with TestClient(full_app, raise_server_exceptions=False) as client:
            response = client.get("/projects/")
            assert response.status_code == 200, response.text
    finally:
        full_app.state.auth_service = previous_service
        full_app.state.auth_settings = previous_settings
        if had_context:
            full_app.state.test_auth_context = previous_context
        else:
            del full_app.state.test_auth_context
        engine.dispose()


def test_direct_production_settings_reject_test_bypass():
    with pytest.raises(RuntimeError, match="APP_ENV=test"):
        AuthSettings(
            signing_secret="s" * 32,
            app_env="production",
            allow_test_bypass=True,
        )
