"""HTTP API for the Source domain (SRC-00)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request

from .source_models import (
    SourceChapterCreate,
    SourceChapterList,
    SourceChapterRead,
    SourceDocumentCreate,
    SourceDocumentList,
    SourceDocumentRead,
    SourceEpisodeList,
    SourceLinkResponse,
    SourceRevisionCreate,
    SourceRevisionList,
    SourceRevisionRead,
)
from ...storage.source_repository import SourceRepository, SourceRepositoryError
from .audit import record_request_event


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
def list_source_chapters(source_id: str, request: Request):
    items = _repository(request).list_chapters(_workspace_id(request), source_id)
    return {"items": items, "total": len(items)}


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
