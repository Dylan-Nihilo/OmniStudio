"""Playground API routes — generation, history, and template management."""

import os
import uuid
from contextvars import copy_context
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File, Request

from .models import (
    CreateTemplateRequest,
    GenerateRequest,
    PlaygroundTemplate,
    SaveToLibraryRequest,
    UpdateTemplateRequest,
)
from .service import PlaygroundService
from .storage import PlaygroundStorage
from ...utils import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["playground"])

# Module-level singletons — initialised when the router is first imported.
_storage = PlaygroundStorage()
_service = PlaygroundService(_storage)


def _workspace_id(request: Request) -> str:
    context = request.state.auth_context
    if (
        getattr(getattr(context, "membership", None), "role", "owner") == "owner"
        and getattr(context.workspace, "slug", None) == "default"
    ):
        _storage.claim_unscoped(context.workspace.id)
    return context.workspace.id


def _workspace_input_media(value: str, workspace_id: str) -> bool:
    if value.startswith(("http://", "https://")):
        return True
    normalized = value.strip().replace("\\", "/").lstrip("/")
    if normalized.startswith("output/"):
        normalized = normalized[len("output/") :]
    return any(
        normalized.startswith(f"playground/{kind}/{workspace_id}/")
        for kind in ("uploads", "images", "videos")
    )

# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


def generate(payload: GenerateRequest, background_tasks: BackgroundTasks, http_request: Request):
    """Create a generation record and kick off processing in the background."""
    workspace_id = _workspace_id(http_request)
    if any(not _workspace_input_media(item, workspace_id) for item in payload.input_media or []):
        raise HTTPException(status_code=404, detail="Input media not found")
    gen = _service.create_generation(payload, workspace_id)
    context = copy_context()
    background_tasks.add_task(context.run, _service.process_generation, gen.id)
    return gen


router.add_api_route("/generate", generate, methods=["POST"])

# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------


def list_history(http_request: Request, limit: int = 50, offset: int = 0):
    """Return paginated generation history, newest first."""
    return _storage.list_history(
        limit=limit,
        offset=offset,
        workspace_id=_workspace_id(http_request),
    )


def get_generation(generation_id: str, http_request: Request):
    """Return full details for a single generation."""
    gen = _storage.get_generation(generation_id, _workspace_id(http_request))
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    return gen


def get_generation_status(generation_id: str, http_request: Request):
    """Return lightweight status payload for polling."""
    gen = _storage.get_generation(generation_id, _workspace_id(http_request))
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    return {
        "id": gen.id,
        "status": gen.status,
        "outputs": gen.outputs,
        "error": gen.error,
    }


def delete_generation(generation_id: str, http_request: Request):
    """Delete a generation record and its outputs."""
    if not _storage.delete_generation(generation_id, _workspace_id(http_request)):
        raise HTTPException(status_code=404, detail="Generation not found")
    return {"ok": True}


def save_to_library(
    generation_id: str,
    output_id: str,
    http_request: Request,
    request: Optional[SaveToLibraryRequest] = None,
):
    """Save a specific generation output to the project library."""
    category = request.category if request else "general"
    context = http_request.state.auth_context
    if getattr(getattr(context, "membership", None), "role", "owner") != "owner":
        raise HTTPException(status_code=403, detail="Workspace Owner required")
    if not _service.save_to_library(
        generation_id,
        output_id,
        category,
        _workspace_id(http_request),
    ):
        raise HTTPException(status_code=404, detail="Generation or output not found")
    return {"ok": True}


router.add_api_route("/history", list_history, methods=["GET"])
router.add_api_route("/history/{generation_id}", get_generation, methods=["GET"])
router.add_api_route(
    "/history/{generation_id}/status", get_generation_status, methods=["GET"]
)
router.add_api_route(
    "/history/{generation_id}", delete_generation, methods=["DELETE"]
)
router.add_api_route(
    "/history/{generation_id}/outputs/{output_id}/save-to-library",
    save_to_library,
    methods=["POST"],
)

# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


def list_templates(http_request: Request):
    """Return all saved prompt templates."""
    return _storage.list_templates(_workspace_id(http_request))


def create_template(payload: CreateTemplateRequest, http_request: Request):
    """Create a new prompt template."""
    now = datetime.now(timezone.utc).isoformat()
    template = PlaygroundTemplate(
        id=str(uuid.uuid4()),
        workspace_id=_workspace_id(http_request),
        name=payload.name,
        category=payload.category or "general",
        prompt=payload.prompt,
        negative_prompt=payload.negative_prompt,
        default_mode=payload.default_mode,
        default_model_id=payload.default_model_id,
        default_parameters=payload.default_parameters or {},
        created_at=now,
        updated_at=now,
    )
    _storage.add_template(template)
    return template


def update_template(template_id: str, payload: UpdateTemplateRequest, http_request: Request):
    """Update an existing prompt template (partial update)."""
    template = _storage.get_template(template_id, _workspace_id(http_request))
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    update_data = payload.model_dump(exclude_none=True)
    for key, value in update_data.items():
        setattr(template, key, value)
    template.updated_at = datetime.now(timezone.utc).isoformat()
    _storage.update_template(template)
    return template


def delete_template(template_id: str, http_request: Request):
    """Delete a prompt template."""
    if not _storage.delete_template(template_id, _workspace_id(http_request)):
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


router.add_api_route("/templates", list_templates, methods=["GET"])
router.add_api_route("/templates", create_template, methods=["POST"])
router.add_api_route("/templates/{template_id}", update_template, methods=["PUT"])
router.add_api_route("/templates/{template_id}", delete_template, methods=["DELETE"])

# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

UPLOAD_DIR = os.path.join("output", "playground", "uploads")


async def upload_media(request: Request, file: UploadFile = File(...)):
    """Upload a media file for use as playground input (reference image, first frame, etc.)."""
    upload_dir = os.path.join(UPLOAD_DIR, _workspace_id(request))
    os.makedirs(upload_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "file")[1] or ".bin"
    filename = f"{uuid.uuid4()}{ext}"
    dest = os.path.join(upload_dir, filename)
    contents = await file.read()
    with open(dest, "wb") as f:
        f.write(contents)
    return {"path": dest}


router.add_api_route("/upload", upload_media, methods=["POST"])
