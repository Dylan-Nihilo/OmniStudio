from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from src.apps.comic_gen.auth.settings import AuthSettings
from src.apps.comic_gen.auth.service import AuthService
from src.storage.auth_repository import AuthRepository
from src.storage.db import create_engine, init_schema


class _Repository:
    def workspace_for_script(self, resource_id: str):
        return "workspace-a"

    def workspace_for_series(self, resource_id: str):
        return None


class _Pipeline:
    repository = _Repository()

    def __init__(self, script):
        self.scripts = {script.id: script}
        self.series_store = {}


def _configure_full_app(tmp_path, monkeypatch, *, workspace_id="workspace-a", pipeline=None):
    from src.apps.comic_gen import api as api_module

    engine = create_engine(tmp_path / "media-auth.db")
    init_schema(engine)
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
        "test_auth_context": getattr(api_module.app.state, "test_auth_context", None),
        "pipeline": api_module.pipeline,
        "media_project_root": getattr(api_module, "MEDIA_PROJECT_ROOT", None),
    }
    api_module.app.state.auth_service = service
    api_module.app.state.auth_settings = settings
    api_module.app.state.test_auth_context = SimpleNamespace(
        user=SimpleNamespace(id="user-a"),
        workspace=SimpleNamespace(id=workspace_id),
        session=SimpleNamespace(id="session-a"),
    )
    if pipeline is not None:
        monkeypatch.setattr(api_module, "pipeline", pipeline)
    media_root = tmp_path / "project-root"
    (media_root / "output" / "storyboard").mkdir(parents=True)
    api_module.MEDIA_PROJECT_ROOT = media_root
    return api_module.app, engine, previous, api_module


def _restore_full_app(api_module, engine, previous):
    api_module.app.state.auth_service = previous["auth_service"]
    api_module.app.state.auth_settings = previous["auth_settings"]
    if previous["test_auth_context"] is None:
        api_module.app.state.test_auth_context = None
    else:
        api_module.app.state.test_auth_context = previous["test_auth_context"]
    api_module.pipeline = previous["pipeline"]
    if previous["media_project_root"] is None and hasattr(api_module, "MEDIA_PROJECT_ROOT"):
        delattr(api_module, "MEDIA_PROJECT_ROOT")
    else:
        api_module.MEDIA_PROJECT_ROOT = previous["media_project_root"]
    engine.dispose()


def test_media_requires_authentication(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as api_module

    app, engine, previous, _ = _configure_full_app(tmp_path, monkeypatch)
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            app.state.test_auth_context = None
            response = client.get("/files/storyboard/frame.png")
        assert response.status_code in {401, 428}
    finally:
        _restore_full_app(api_module, engine, previous)


def test_media_project_root_follows_runtime_working_directory(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as api_module

    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("OMNI_STUDIO_MEDIA_PROJECT_ROOT", raising=False)
    assert api_module._get_media_project_root() == tmp_path.resolve()


def test_media_project_root_accepts_explicit_override(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as api_module

    configured_root = tmp_path / "runtime"
    monkeypatch.setenv("OMNI_STUDIO_MEDIA_PROJECT_ROOT", str(configured_root))
    assert api_module._get_media_project_root() == configured_root.resolve()


def test_owned_media_supports_range_and_rejects_unreferenced_paths(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as api_module

    script = SimpleNamespace(
        id="script-a",
        model_dump=lambda: {"id": "script-a", "storyboard": [{"image_url": "storyboard/frame.png"}]},
    )
    pipeline = _Pipeline(script)
    app, engine, previous, _ = _configure_full_app(tmp_path, monkeypatch, pipeline=pipeline)
    media_file = tmp_path / "project-root" / "output" / "storyboard" / "frame.png"
    media_file.write_bytes(b"0123456789")
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            full = client.get("/files/storyboard/frame.png")
            ranged = client.get("/files/storyboard/frame.png", headers={"Range": "bytes=2-5"})
            guessed = client.get("/files/storyboard/other.png")
            traversal = client.get("/files/../omni_studio.db")
        assert full.status_code == 200
        assert full.content == b"0123456789"
        assert ranged.status_code == 206
        assert ranged.content == b"2345"
        assert guessed.status_code in {403, 404}
        assert traversal.status_code in {403, 404}
    finally:
        _restore_full_app(api_module, engine, previous)


def test_authenticated_workspace_can_read_voice_preview_cache(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as api_module

    script = SimpleNamespace(
        id="script-voice-preview",
        model_dump=lambda: {"id": "script-voice-preview", "title": "Voice preview"},
    )
    pipeline = _Pipeline(script)
    app, engine, previous, _ = _configure_full_app(tmp_path, monkeypatch, pipeline=pipeline)
    media_root = tmp_path / "project-root" / "output" / "cache"
    preview_file = media_root / "voice_preview" / "sample.mp3"
    design_file = media_root / "voice_design_preview" / "sample.mp3"
    for media_file in (preview_file, design_file):
        media_file.parent.mkdir(parents=True, exist_ok=True)
        media_file.write_bytes(b"voice-preview")
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/files/cache/voice_preview/sample.mp3")
            design_response = client.get("/files/cache/voice_design_preview/sample.mp3")
            guessed = client.get("/files/cache/voice_preview/other.mp3")
        assert response.status_code == 200
        assert response.content == b"voice-preview"
        assert design_response.status_code == 200
        assert design_response.content == b"voice-preview"
        assert guessed.status_code in {403, 404}
    finally:
        _restore_full_app(api_module, engine, previous)


def test_media_from_other_workspace_is_not_readable(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as api_module

    script = SimpleNamespace(
        id="script-b",
        model_dump=lambda: {"id": "script-b", "storyboard": [{"image_url": "storyboard/frame.png"}]},
    )
    pipeline = _Pipeline(script)
    app, engine, previous, _ = _configure_full_app(
        tmp_path, monkeypatch, workspace_id="workspace-a", pipeline=pipeline
    )
    media_file = tmp_path / "project-root" / "output" / "storyboard" / "frame.png"
    media_file.write_bytes(b"private")
    pipeline.repository.workspace_for_script = lambda resource_id: "workspace-b"
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/files/storyboard/frame.png")
        assert response.status_code in {403, 404}
    finally:
        _restore_full_app(api_module, engine, previous)


def test_authenticated_workspace_can_read_referenced_global_library_media(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as api_module

    script = SimpleNamespace(id="script-global", model_dump=lambda: {"id": "script-global"})
    library_asset = SimpleNamespace(
        model_dump=lambda: {"id": "asset-global", "image_url": "uploads/library.jpg"}
    )
    pipeline = _Pipeline(script)
    pipeline.library_store = SimpleNamespace(
        model_dump=lambda: {
            "characters": [library_asset.model_dump()],
            "scenes": [],
            "props": [],
        }
    )
    app, engine, previous, _ = _configure_full_app(tmp_path, monkeypatch, pipeline=pipeline)
    media_file = tmp_path / "project-root" / "output" / "uploads" / "library.jpg"
    media_file.parent.mkdir(parents=True, exist_ok=True)
    media_file.write_bytes(b"global-library")
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/files/uploads/library.jpg")
        assert response.status_code == 200
        assert response.content == b"global-library"
    finally:
        _restore_full_app(api_module, engine, previous)
