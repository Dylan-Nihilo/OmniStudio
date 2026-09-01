from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.apps.comic_gen.auth.routes import auth_exception_handler, router
from src.apps.comic_gen.auth.service import AuthError, AuthService
from src.apps.comic_gen.auth.settings import AuthSettings
from src.storage.auth_repository import AuthRepository
from src.storage.db import create_engine, init_schema


def make_auth_app(
    tmp_path: Path,
    *,
    setup_token: str | None = None,
    password_reset_token: str | None = None,
):
    engine = create_engine(tmp_path / "auth.db")
    init_schema(engine)
    settings = AuthSettings(
        signing_secret="test-signing-secret-012345678901234567890123456789",
        setup_token=setup_token,
        password_reset_token=password_reset_token,
        access_ttl_seconds=900,
        refresh_ttl_seconds=7 * 86400,
        cookie_secure=False,
        allowed_origins=("http://testserver",),
    )
    service = AuthService(AuthRepository(engine), settings)
    app = FastAPI()
    app.state.storage_engine = engine
    app.state.auth_settings = settings
    app.state.auth_service = service
    app.add_exception_handler(AuthError, auth_exception_handler)
    app.include_router(router)
    return app, engine, service


class AuthTestClient(TestClient):
    def request(self, method, url, **kwargs):
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("Origin", "http://testserver")
        if method.upper() in {"POST", "PUT", "PATCH", "DELETE"} and "X-CSRF-Token" not in headers:
            csrf = self.cookies.get("omni_studio_csrf")
            if not csrf and str(url).startswith("/auth/"):
                # Clearing cookies between login attempts is common in the
                # auth tests; bootstrap the pre-auth CSRF cookie again.
                self.get("/auth/setup-status")
                csrf = self.cookies.get("omni_studio_csrf")
            if csrf:
                headers["X-CSRF-Token"] = csrf
        kwargs["headers"] = headers
        return super().request(method, url, **kwargs)


def make_client(app: FastAPI, *, local: bool = False) -> TestClient:
    peer = ("127.0.0.1", 41000) if local else ("198.51.100.20", 41000)
    client = AuthTestClient(app, client=peer)
    # Bootstrap the pre-auth CSRF cookie for every auth integration test.
    client.get("/auth/setup-status")
    return client
