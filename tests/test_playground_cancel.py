"""Regression tests for canceling in-flight Playground generations."""

from datetime import datetime, timezone

from src.apps.playground.models import PlaygroundGeneration, PlaygroundMode
from src.apps.playground.service import PlaygroundService
from src.apps.playground.storage import PlaygroundStorage


def _generation(generation_id: str = "generation-1", status: str = "processing"):
    return PlaygroundGeneration(
        id=generation_id,
        workspace_id="workspace-1",
        mode=PlaygroundMode.T2I,
        model_id="test-image-model",
        prompt="A test image",
        status=status,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def _storage(tmp_path):
    storage = PlaygroundStorage()
    storage.HISTORY_PATH = str(tmp_path / "history.json")
    storage.TEMPLATES_PATH = str(tmp_path / "templates.json")
    storage._history = []
    storage._templates = []
    return storage


def test_cancel_generation_marks_processing_record_failed(tmp_path):
    storage = _storage(tmp_path)
    storage.add_generation(_generation())
    service = PlaygroundService(storage)

    canceled = service.cancel_generation("generation-1", "workspace-1")

    assert canceled is not None
    assert canceled.status == "failed"
    assert canceled.error == "Canceled by user"
    persisted = storage.get_generation("generation-1", "workspace-1")
    assert persisted is not None
    assert persisted.status == "failed"


def test_cancel_generation_rejects_unknown_or_terminal_record(tmp_path):
    storage = _storage(tmp_path)
    storage.add_generation(_generation(status="completed"))
    service = PlaygroundService(storage)

    assert service.cancel_generation("missing", "workspace-1") is None
    assert service.cancel_generation("generation-1", "workspace-1") is None


def test_late_provider_completion_does_not_overwrite_cancellation(tmp_path):
    storage = _storage(tmp_path)
    storage.add_generation(_generation(status="pending"))
    service = PlaygroundService(storage)

    def provider_finishes_after_user_cancel(generation):
        assert service.cancel_generation(generation.id, "workspace-1") is not None

    service._process_image_generation = provider_finishes_after_user_cancel
    service.process_generation("generation-1")

    persisted = storage.get_generation("generation-1", "workspace-1")
    assert persisted is not None
    assert persisted.status == "failed"
    assert persisted.error == "Canceled by user"


def test_start_generation_does_not_resurrect_a_canceled_record(tmp_path):
    storage = _storage(tmp_path)
    pending = _generation(status="pending")
    storage.add_generation(pending)

    assert storage.cancel_generation("generation-1", "workspace-1") is not None
    assert storage.start_generation(pending) is False

    persisted = storage.get_generation("generation-1", "workspace-1")
    assert persisted is not None
    assert persisted.status == "failed"


def test_playground_router_exposes_cancel_endpoint():
    from src.apps.playground.api import router

    assert any(
        route.path == "/history/{generation_id}/cancel"
        and "POST" in route.methods
        for route in router.routes
    )
