"""HTTP API for the Source domain (SRC-00)."""

from __future__ import annotations

import uuid
import hashlib
from pathlib import Path

from fastapi import APIRouter, Query, Request
from pydantic import ValidationError

from .source_models import (
    SourceChapterCreate,
    SourceChapterList,
    SourceChapterRead,
    SourceChapterUpdate,
    SourceDocumentCreate,
    SourceDocumentList,
    SourceDocumentRead,
    SourceEpisodeList,
    SourceLinkResponse,
    SourceImportBoundaryPatch,
    SourceImportConfirmResponse,
    SourceImportPreviewRead,
    SourceImportRequest,
    SourceRevisionCreate,
    SourceRevisionList,
    SourceRevisionRead,
)
from ...storage.source_repository import SourceRepository, SourceRepositoryError
from .audit import record_request_event
from .source_import import (
    MAX_IMPORT_BYTES,
    SourceImportError,
    decode_text,
    extract_docx,
    identify_chapters,
    normalize_proposals,
    summarize,
)


router = APIRouter(tags=["sources"])


def _repository(request: Request) -> SourceRepository:
    repository = getattr(request.app.state, "source_repository", None)
    engine = getattr(request.app.state, "storage_engine", None)
    if repository is not None and (engine is None or repository.engine is engine):
        return repository
    if engine is None:
        raise SourceRepositoryError("SOURCE_STORAGE_UNAVAILABLE", "来源资料存储不可用", status_code=503)
    repository = SourceRepository(engine)
    request.app.state.source_repository = repository
    return repository


def _workspace_id(request: Request) -> str:
    context = getattr(request.state, "auth_context", None)
    workspace_id = getattr(getattr(context, "workspace", None), "id", None)
    if not workspace_id:
        raise SourceRepositoryError("AUTH_SESSION_INVALID", "登录状态无效", status_code=401)
    return str(workspace_id)


def _user_id(request: Request) -> str | None:
    user = getattr(getattr(request.state, "auth_context", None), "user", None)
    return str(user.id) if getattr(user, "id", None) else None


def source_error_payload(request: Request, error: SourceRepositoryError) -> dict[str, object]:
    return {
        "error": {
            "code": error.code,
            "message": error.message,
            "request_id": str(getattr(request.state, "request_id", "") or f"req_{uuid.uuid4().hex}"),
        }
    }


def _import_error(error: Exception) -> SourceRepositoryError:
    if isinstance(error, SourceImportError):
        return SourceRepositoryError(error.code, error.message, status_code=error.status_code)
    if isinstance(error, ValidationError):
        return SourceRepositoryError("SOURCE_IMPORT_INVALID_INPUT", "导入参数无效", status_code=422)
    return SourceRepositoryError("SOURCE_IMPORT_INVALID_INPUT", "导入参数无效", status_code=422)


async def _read_import_request(request: Request) -> tuple[str, str, str | None, str, str, str]:
    """Accept JSON paste requests and multipart TXT/DOCX requests on one endpoint."""
    content_type = request.headers.get("content-type", "").lower()
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        uploaded = form.get("file")
        if uploaded is None or not hasattr(uploaded, "read"):
            raise SourceImportError("SOURCE_IMPORT_FILE_REQUIRED", "请上传 TXT 或 DOCX 文件")
        filename = str(getattr(uploaded, "filename", "") or "").strip()
        raw = await uploaded.read()
        if len(raw) > MAX_IMPORT_BYTES:
            raise SourceImportError("SOURCE_IMPORT_TOO_LARGE", "导入文件不能超过 10 MB", status_code=413)
        suffix = Path(filename).suffix.lower()
        requested_type = str(form.get("source_type") or "").strip().lower()
        if suffix == ".docx" or requested_type == "docx":
            decoded = extract_docx(raw)
            source_type = "docx"
        elif suffix in {".txt", ".text", ".md", ".markdown"} or requested_type in {"txt", "text", "markdown"}:
            decoded = decode_text(raw)
            source_type = "markdown" if suffix in {".md", ".markdown"} or requested_type == "markdown" else "txt"
        else:
            raise SourceImportError("SOURCE_IMPORT_FILE_TYPE", "仅支持 TXT、Markdown 或 DOCX 文件")
        title = str(form.get("title") or Path(filename).stem or "未命名来源").strip()
        if not title:
            raise SourceImportError("SOURCE_IMPORT_INVALID_INPUT", "导入标题不能为空")
        return source_type, title, filename or None, decoded.encoding, decoded.content, summarize(decoded.content)

    try:
        raw_payload = await request.json()
        payload = SourceImportRequest.model_validate(raw_payload)
    except (ValueError, ValidationError) as exc:
        raise _import_error(exc) from exc
    if len(payload.content.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise SourceImportError("SOURCE_IMPORT_TOO_LARGE", "导入正文不能超过 10 MB", status_code=413)
    return payload.source_type, payload.title.strip(), payload.original_filename, "utf-8", payload.content, summarize(payload.content)


@router.post("/sources/import/preview", response_model=SourceImportPreviewRead, status_code=201)
async def preview_source_import(request: Request):
    try:
        source_type, title, filename, encoding, content, summary = await _read_import_request(request)
        proposals = normalize_proposals(content, identify_chapters(content))
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        result = _repository(request).create_import_preview(
            workspace_id=_workspace_id(request),
            source_type=source_type,
            title=title,
            original_filename=filename,
            encoding=encoding,
            content=content,
            summary=summary,
            proposals=proposals,
            user_id=_user_id(request),
            content_sha256=digest,
        )
    except SourceRepositoryError:
        raise
    except (SourceImportError, ValidationError, ValueError) as exc:
        raise _import_error(exc) from exc
    record_request_event(request, action="source.import.preview", object_type="source_import_preview", object_id=result["id"])
    return result


@router.get("/sources/import/previews/{preview_id}", response_model=SourceImportPreviewRead)
def get_source_import_preview(preview_id: str, request: Request):
    return _repository(request).get_import_preview(_workspace_id(request), preview_id)


@router.patch("/sources/import/previews/{preview_id}/boundaries", response_model=SourceImportPreviewRead)
async def patch_source_import_boundaries(preview_id: str, request: Request):
    try:
        body = await request.json()
        raw_proposals = body.get("proposals", body.get("chapters")) if isinstance(body, dict) else None
        patch = SourceImportBoundaryPatch.model_validate({"proposals": raw_proposals})
        repository = _repository(request)
        content = repository.get_import_preview_content(_workspace_id(request), preview_id)
        proposals = normalize_proposals(content, [item.model_dump() for item in patch.proposals])
        result = _repository(request).update_import_preview_boundaries(
            workspace_id=_workspace_id(request), preview_id=preview_id, proposals=proposals
        )
    except SourceRepositoryError:
        raise
    except (SourceImportError, ValidationError, ValueError) as exc:
        raise _import_error(exc) from exc
    record_request_event(request, action="source.import.boundaries.update", object_type="source_import_preview", object_id=preview_id)
    return result


@router.post("/sources/import/previews/{preview_id}/confirm", response_model=SourceImportConfirmResponse)
def confirm_source_import(preview_id: str, request: Request):
    result = _repository(request).confirm_import_preview(
        workspace_id=_workspace_id(request), preview_id=preview_id, user_id=_user_id(request)
    )
    record_request_event(request, action="source.import.confirm", object_type="source_document", object_id=result["id"], metadata={"preview_id": preview_id})
    return {"preview_id": preview_id, "status": "confirmed", "source_document": result}


@router.post("/sources/import/previews/{preview_id}/cancel", response_model=SourceImportPreviewRead)
def cancel_source_import(preview_id: str, request: Request):
    result = _repository(request).cancel_import_preview(
        workspace_id=_workspace_id(request), preview_id=preview_id
    )
    record_request_event(request, action="source.import.cancel", object_type="source_import_preview", object_id=preview_id)
    return result


@router.post("/sources", response_model=SourceDocumentRead, status_code=201)
def create_source(request: Request, payload: SourceDocumentCreate):
    result = _repository(request).create_document(
        workspace_id=_workspace_id(request),
        title=payload.title,
        source_type=payload.source_type,
        original_filename=payload.original_filename,
        encoding=payload.encoding,
        summary=payload.summary,
        metadata=payload.metadata,
    )
    record_request_event(request, action="source.create", object_type="source_document", object_id=result["id"])
    return result


@router.get("/sources", response_model=SourceDocumentList)
def list_sources(request: Request):
    items = _repository(request).list_documents(_workspace_id(request))
    return {"items": items, "total": len(items)}


@router.get("/sources/{source_id}", response_model=SourceDocumentRead)
def get_source(source_id: str, request: Request):
    return _repository(request).get_document(_workspace_id(request), source_id)


@router.get("/sources/{source_id}/chapters", response_model=SourceChapterList)
def list_source_chapters(
    source_id: str,
    request: Request,
    q: str = Query(default="", max_length=200),
    search: str | None = Query(default=None, max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
):
    return _repository(request).list_chapters_page(
        _workspace_id(request), source_id, query=search if search is not None else q,
        page=page, page_size=page_size,
    )


@router.post("/sources/{source_id}/chapters", response_model=SourceChapterRead, status_code=201)
def create_source_chapter(source_id: str, request: Request, payload: SourceChapterCreate):
    result = _repository(request).create_chapter(
        workspace_id=_workspace_id(request),
        source_id=source_id,
        chapter_number=payload.chapter_number,
        title=payload.title,
        content=payload.content,
        metadata=payload.metadata,
        user_id=_user_id(request),
    )
    record_request_event(request, action="source.chapter.create", object_type="source_chapter", object_id=result["id"])
    return result


@router.patch("/sources/{source_id}/chapters/{chapter_id}", response_model=SourceChapterRead)
@router.put("/sources/{source_id}/chapters/{chapter_id}", response_model=SourceChapterRead)
def update_source_chapter(source_id: str, chapter_id: str, request: Request, payload: SourceChapterUpdate):
    result = _repository(request).update_chapter(
        workspace_id=_workspace_id(request),
        source_id=source_id,
        chapter_id=chapter_id,
        title=payload.title,
        content=payload.content,
        user_id=_user_id(request),
    )
    record_request_event(request, action="source.chapter.update", object_type="source_chapter", object_id=chapter_id)
    return result


@router.get("/sources/{source_id}/chapters/{chapter_id}", response_model=SourceChapterRead)
def get_source_chapter(source_id: str, chapter_id: str, request: Request):
    return _repository(request).get_chapter(_workspace_id(request), source_id, chapter_id)


@router.get("/sources/{source_id}/chapters/{chapter_id}/revisions", response_model=SourceRevisionList)
def list_source_revisions(source_id: str, chapter_id: str, request: Request):
    items = _repository(request).list_revisions(_workspace_id(request), source_id, chapter_id)
    return {"items": items, "total": len(items)}


@router.post("/sources/{source_id}/chapters/{chapter_id}/revisions", response_model=SourceRevisionRead, status_code=201)
def create_source_revision(source_id: str, chapter_id: str, request: Request, payload: SourceRevisionCreate):
    result = _repository(request).create_revision(
        workspace_id=_workspace_id(request),
        source_id=source_id,
        chapter_id=chapter_id,
        content=payload.content,
        metadata=payload.metadata,
        user_id=_user_id(request),
    )
    record_request_event(request, action="source.revision.create", object_type="source_revision", object_id=result["id"])
    return result


@router.post(
    "/sources/{source_id}/chapters/{chapter_id}/revisions/{revision_id}/restore",
    response_model=SourceRevisionRead,
)
def restore_source_revision(source_id: str, chapter_id: str, revision_id: str, request: Request):
    result = _repository(request).restore_revision(
        workspace_id=_workspace_id(request),
        source_id=source_id,
        chapter_id=chapter_id,
        revision_id=revision_id,
        user_id=_user_id(request),
    )
    record_request_event(
        request,
        action="source.revision.restore",
        object_type="source_revision",
        object_id=result["id"],
        metadata={"restored_from_revision_id": revision_id, "chapter_id": chapter_id},
    )
    return result


@router.get("/sources/{source_id}/episodes", response_model=SourceEpisodeList)
def list_source_episodes(source_id: str, request: Request):
    items = _repository(request).list_episodes(_workspace_id(request), source_id)
    return {"items": items, "total": len(items)}


@router.post("/sources/{source_id}/episodes/{episode_id}", response_model=SourceLinkResponse, status_code=201)
def link_source_episode(source_id: str, episode_id: str, request: Request):
    result = _repository(request).link_episode(
        workspace_id=_workspace_id(request),
        source_id=source_id,
        episode_id=episode_id,
        user_id=_user_id(request),
    )
    record_request_event(request, action="source.episode.link", object_type="source_document", object_id=source_id, metadata={"episode_id": episode_id, "created": result["created"]})
    return result


@router.delete("/sources/{source_id}/episodes/{episode_id}", response_model=SourceLinkResponse)
def unlink_source_episode(source_id: str, episode_id: str, request: Request):
    removed = _repository(request).unlink_episode(
        workspace_id=_workspace_id(request),
        source_id=source_id,
        episode_id=episode_id,
    )
    result = {"source_document_id": source_id, "episode_id": episode_id, "created": False, "linked": False}
    record_request_event(request, action="source.episode.unlink", object_type="source_document", object_id=source_id, metadata={"episode_id": episode_id, "removed": removed})
    return result


@router.get("/episodes/{episode_id}/sources", response_model=SourceDocumentList)
def list_episode_sources(episode_id: str, request: Request):
    items = _repository(request).list_sources_for_episode(_workspace_id(request), episode_id)
    return {"items": items, "total": len(items)}


__all__ = ["router", "source_error_payload"]
