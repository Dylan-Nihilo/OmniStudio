"""HTTP API for the Source domain (SRC-00 through SRC-09)."""

from __future__ import annotations

import uuid
import hashlib
import logging
from pathlib import Path

from fastapi import APIRouter, Query, Request
from pydantic import ValidationError

from .source_models import (
    SourceChapterCreate,
    SourceChapterAnalysisHistory,
    SourceChapterAnalysisRead,
    SourceChapterAnalysisRequest,
    SourceChapterList,
    SourceChapterRead,
    SourceChapterEvent,
    SourceAnalysisBatchRead,
    SourceAnalysisBatchRequest,
    SourceAnalysisBatchRetryRequest,
    SourceChapterUpdate,
    SourceDocumentCreate,
    SourceDocumentList,
    SourceDocumentRead,
    SourceEpisodeSplitConfirmRequest,
    SourceEpisodeSplitConfirmResponse,
    SourceEpisodeSplitPatch,
    SourceEpisodeSplitPreviewRead,
    SourceEpisodeSplitPreviewRequest,
    SourceEpisodeSplitProposal,
    SourceEpisodeList,
    SourceLinkResponse,
    SourceImportBoundaryPatch,
    SourceImportConfirmResponse,
    SourceImportPreviewRead,
    SourceImportRequest,
    SourceRevisionImpactList,
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
logger = logging.getLogger(__name__)


def _pipeline(request: Request):
    """Resolve the pipeline matching the request's test/runtime storage engine."""
    engine = getattr(request.app.state, "storage_engine", None)
    candidate = getattr(request.app.state, "comic_pipeline", None)
    if candidate is not None and (engine is None or candidate.storage_engine is engine):
        return candidate
    # The fallback keeps test fixtures that replace api.pipeline isolated while
    # avoiding an import cycle during module initialization.
    from . import api as api_module

    return api_module.pipeline


def _normalize_episode_split_proposals(
    raw: object, *, user_input: bool = False
) -> list[dict[str, object]]:
    error_code = "SOURCE_EPISODE_SPLIT_INVALID_INPUT" if user_input else "SOURCE_AI_SPLIT_INVALID"
    error_status = 422 if user_input else 502
    if not isinstance(raw, list) or not raw:
        raise SourceRepositoryError(
            "SOURCE_EPISODE_SPLIT_EMPTY" if user_input else "SOURCE_AI_SPLIT_EMPTY",
            "至少需要一个分集提案" if user_input else "AI 未返回有效的分集提案",
            status_code=error_status,
        )
    normalized: list[dict[str, object]] = []
    numbers: set[int] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise SourceRepositoryError(error_code, "分集提案格式无效", status_code=error_status)
        candidate = dict(item)
        if candidate.get("estimated_duration") is not None:
            candidate["estimated_duration"] = str(candidate["estimated_duration"])
        try:
            proposal = SourceEpisodeSplitProposal.model_validate(candidate)
        except ValidationError as exc:
            raise SourceRepositoryError(
                error_code,
                "分集提案格式无效" if user_input else "AI 返回的分集提案格式无效",
                status_code=error_status,
            ) from exc
        if proposal.episode_number in numbers:
            raise SourceRepositoryError(
                error_code,
                "分集提案包含重复的集数" if user_input else "AI 返回了重复的集数",
                status_code=error_status,
            )
        numbers.add(proposal.episode_number)
        normalized.append(proposal.model_dump())
    return sorted(normalized, key=lambda item: int(item["episode_number"]))


class _ChapterAnalysisFailure(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def _normalize_chapter_events(raw: object) -> list[dict[str, object]]:
    if isinstance(raw, dict):
        raw = raw.get("events")
    if not isinstance(raw, list):
        raise _ChapterAnalysisFailure("SOURCE_CHAPTER_ANALYSIS_INVALID", "AI 未返回有效的事件列表")
    if len(raw) > 100:
        raise _ChapterAnalysisFailure("SOURCE_CHAPTER_ANALYSIS_INVALID", "AI 返回的事件数量超过限制")
    normalized: list[dict[str, object]] = []
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            raise _ChapterAnalysisFailure("SOURCE_CHAPTER_ANALYSIS_INVALID", "AI 返回的事件格式无效")
        event_type = item.get("event_type", item.get("type", item.get("event", "other")))
        description = item.get("description", item.get("summary", item.get("content", "")))
        characters = item.get("characters", item.get("participants", []))
        if isinstance(characters, str):
            characters = [characters]
        if not isinstance(characters, list):
            characters = []
        importance = str(item.get("importance", "medium")).lower()
        if importance in {"critical", "major", "重要", "高"}:
            importance = "high"
        elif importance in {"minor", "低"}:
            importance = "low"
        elif importance not in {"low", "medium", "high"}:
            importance = "medium"
        candidate = {
            "sequence": item.get("sequence", index),
            "event_type": str(event_type or "other"),
            "description": str(description or "").strip(),
            "characters": [str(value).strip() for value in characters if str(value).strip()],
            "location": str(item.get("location", item.get("scene", "")) or "").strip(),
            "importance": importance,
            "source_excerpt": str(item.get("source_excerpt", item.get("excerpt", "")) or "").strip(),
        }
        try:
            normalized.append(SourceChapterEvent.model_validate(candidate).model_dump())
        except ValidationError as exc:
            raise _ChapterAnalysisFailure("SOURCE_CHAPTER_ANALYSIS_INVALID", "AI 返回的事件字段无效") from exc
    return sorted(normalized, key=lambda item: int(item["sequence"]))


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


def _run_chapter_analysis(
    request: Request,
    repository: SourceRepository,
    *,
    workspace_id: str,
    source_id: str,
    chapter_id: str,
    force: bool = False,
) -> tuple[dict[str, object], str]:
    context, content = repository.get_chapter_analysis_input(
        workspace_id, source_id, chapter_id
    )
    latest = repository.get_latest_chapter_analysis(workspace_id, source_id, chapter_id)
    if (
        latest
        and latest["status"] == "succeeded"
        and latest["revision_id"] == context["revision_id"]
        and not force
    ):
        return {**latest, "reused": True}, "skipped"

    attempt = int(latest["attempt"]) + 1 if latest else 1
    retry_of = str(latest["id"]) if latest and latest["status"] == "failed" else None
    try:
        raw_events = _pipeline(request).analyze_source_chapter_events(
            str(context["chapter_title"]), content
        )
        events = _normalize_chapter_events(raw_events)
    except _ChapterAnalysisFailure as exc:
        failure_code, failure_message = exc.code, exc.message
        events = []
    except ValueError:
        failure_code = "SOURCE_CHAPTER_ANALYSIS_UNAVAILABLE"
        failure_message = "AI 分析服务不可用，请检查配置后重试"
        events = []
    except Exception:
        logger.exception("Source chapter analysis failed")
        failure_code = "SOURCE_CHAPTER_ANALYSIS_FAILED"
        failure_message = "章节事件分析失败，请稍后重试"
        events = []
    else:
        result = repository.record_chapter_analysis(
            workspace_id=workspace_id,
            source_id=source_id,
            chapter_id=chapter_id,
            expected_revision_id=str(context["revision_id"]),
            expected_content_sha256=str(context["content_sha256"]),
            status="succeeded",
            events=events,
            error_code=None,
            error_message=None,
            attempt=attempt,
            retry_of=retry_of,
            user_id=_user_id(request),
        )
        return result, "succeeded"

    result = repository.record_chapter_analysis(
        workspace_id=workspace_id,
        source_id=source_id,
        chapter_id=chapter_id,
        expected_revision_id=str(context["revision_id"]),
        expected_content_sha256=str(context["content_sha256"]),
        status="failed",
        events=events,
        error_code=failure_code,
        error_message=failure_message,
        attempt=attempt,
        retry_of=retry_of,
        user_id=_user_id(request),
    )
    return result, "failed"


def _process_analysis_batch(
    request: Request,
    repository: SourceRepository,
    *,
    workspace_id: str,
    source_id: str,
    batch_id: str,
    chapter_ids: list[str] | None = None,
    force: bool = False,
) -> dict[str, object]:
    batch = repository.get_analysis_batch(workspace_id, batch_id)
    selected = set(chapter_ids or [str(item["chapter_id"]) for item in batch["items"]])
    for item in batch["items"]:
        chapter_id = str(item["chapter_id"])
        if chapter_id not in selected or item["status"] not in {"pending", "processing"}:
            continue
        repository.update_analysis_batch_item(
            workspace_id=workspace_id,
            batch_id=batch_id,
            chapter_id=chapter_id,
            status="processing",
            attempt=int(item["attempt"]) + 1,
        )
        try:
            analysis, outcome = _run_chapter_analysis(
                request,
                repository,
                workspace_id=workspace_id,
                source_id=source_id,
                chapter_id=chapter_id,
                force=force,
            )
        except SourceRepositoryError as exc:
            repository.update_analysis_batch_item(
                workspace_id=workspace_id,
                batch_id=batch_id,
                chapter_id=chapter_id,
                status="failed",
                attempt=int(item["attempt"]) + 1,
                error_code=exc.code,
                error_message=exc.message,
            )
            continue
        if outcome == "skipped":
            repository.update_analysis_batch_item(
                workspace_id=workspace_id,
                batch_id=batch_id,
                chapter_id=chapter_id,
                status="skipped",
                analysis_id=str(analysis["id"]),
                attempt=int(analysis["attempt"]),
                skip_reason="already_analyzed",
            )
        elif outcome == "succeeded":
            repository.update_analysis_batch_item(
                workspace_id=workspace_id,
                batch_id=batch_id,
                chapter_id=chapter_id,
                status="succeeded",
                analysis_id=str(analysis["id"]),
                attempt=int(analysis["attempt"]),
            )
        else:
            repository.update_analysis_batch_item(
                workspace_id=workspace_id,
                batch_id=batch_id,
                chapter_id=chapter_id,
                status="failed",
                analysis_id=str(analysis["id"]),
                attempt=int(analysis["attempt"]),
                error_code=analysis["error_code"],
                error_message=analysis["error_message"],
            )
    return repository.get_analysis_batch(workspace_id, batch_id)


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


@router.post(
    "/sources/{source_id}/episode-splits/preview",
    response_model=SourceEpisodeSplitPreviewRead,
    status_code=201,
)
@router.post(
    "/sources/{source_id}/episode-split/preview",
    response_model=SourceEpisodeSplitPreviewRead,
    status_code=201,
)
@router.post(
    "/sources/{source_id}/episodes/split/preview",
    response_model=SourceEpisodeSplitPreviewRead,
    status_code=201,
)
def preview_source_episode_split(
    source_id: str,
    request: Request,
    payload: SourceEpisodeSplitPreviewRequest,
):
    repository = _repository(request)
    source, content, _ = repository.get_source_episode_split_input(
        _workspace_id(request), source_id
    )
    try:
        raw_proposals = _pipeline(request).import_file_and_split(
            content, payload.suggested_episodes
        )
        proposals = _normalize_episode_split_proposals(raw_proposals)
    except SourceRepositoryError:
        raise
    except ValueError as exc:
        raise SourceRepositoryError(
            "SOURCE_AI_SPLIT_UNAVAILABLE", str(exc), status_code=503
        ) from exc
    except RuntimeError as exc:
        raise SourceRepositoryError(
            "SOURCE_AI_SPLIT_FAILED", "AI 拆集失败，请稍后重试", status_code=502
        ) from exc
    except Exception as exc:
        raise SourceRepositoryError(
            "SOURCE_AI_SPLIT_FAILED", "AI 拆集失败，请稍后重试", status_code=502
        ) from exc
    result = repository.create_episode_split_preview(
        workspace_id=_workspace_id(request),
        source_id=source_id,
        suggested_episodes=payload.suggested_episodes,
        proposals=proposals,
        user_id=_user_id(request),
    )
    record_request_event(
        request,
        action="source.episode_split.preview",
        object_type="source_episode_split_preview",
        object_id=result["id"],
        metadata={"source_document_id": source_id, "proposal_count": len(proposals)},
    )
    return result


@router.get(
    "/sources/episode-split-previews/{preview_id}",
    response_model=SourceEpisodeSplitPreviewRead,
)
@router.get(
    "/sources/episode-splits/previews/{preview_id}",
    response_model=SourceEpisodeSplitPreviewRead,
)
def get_source_episode_split_preview(preview_id: str, request: Request):
    return _repository(request).get_episode_split_preview(_workspace_id(request), preview_id)


@router.patch(
    "/sources/episode-split-previews/{preview_id}",
    response_model=SourceEpisodeSplitPreviewRead,
)
def patch_source_episode_split_preview(
    preview_id: str,
    request: Request,
    payload: SourceEpisodeSplitPatch,
):
    proposals = _normalize_episode_split_proposals(
        [item.model_dump() for item in payload.proposals], user_input=True
    )
    result = _repository(request).update_episode_split_preview(
        workspace_id=_workspace_id(request), preview_id=preview_id, proposals=proposals
    )
    record_request_event(
        request,
        action="source.episode_split.preview.update",
        object_type="source_episode_split_preview",
        object_id=preview_id,
    )
    return result


@router.post(
    "/sources/episode-split-previews/{preview_id}/cancel",
    response_model=SourceEpisodeSplitPreviewRead,
)
def cancel_source_episode_split_preview(preview_id: str, request: Request):
    result = _repository(request).cancel_episode_split_preview(
        workspace_id=_workspace_id(request), preview_id=preview_id
    )
    record_request_event(
        request,
        action="source.episode_split.preview.cancel",
        object_type="source_episode_split_preview",
        object_id=preview_id,
    )
    return result


@router.post(
    "/sources/episode-split-previews/{preview_id}/confirm",
    response_model=SourceEpisodeSplitConfirmResponse,
)
def confirm_source_episode_split(
    preview_id: str,
    request: Request,
    payload: SourceEpisodeSplitConfirmRequest,
):
    repository = _repository(request)
    workspace_id = _workspace_id(request)
    preview, content = repository.get_episode_split_preview_input(workspace_id, preview_id)
    if preview["status"] == "confirmed":
        episode_ids = [str(item) for item in preview["episode_ids"]]
        episodes = repository.list_episode_split_episodes(
            workspace_id, str(preview["series_id"]), episode_ids
        )
        return {
            "preview_id": preview_id,
            "status": "confirmed",
            "source_document_id": preview["source_document_id"],
            "series_id": preview["series_id"],
            "episode_ids": episode_ids,
            "episodes": episodes,
        }
    if preview["status"] == "canceled":
        raise SourceRepositoryError(
            "SOURCE_EPISODE_SPLIT_PREVIEW_CANCELED", "拆集预览已取消，不能确认", status_code=409
        )
    proposals = _normalize_episode_split_proposals(preview["proposals"])
    title = (payload.title or str(preview["title"])).strip()
    if not title:
        raise SourceRepositoryError("SOURCE_INVALID_INPUT", "剧集标题不能为空", status_code=422)
    repository.assert_episode_split_preview_source_current(workspace_id, preview_id)
    pipeline = _pipeline(request)
    try:
        result = pipeline.create_series_from_import(
            title, content, proposals, payload.description
        )
        legacy_repository = getattr(pipeline, "repository", None)
        if legacy_repository is None:
            raise SourceRepositoryError(
                "SOURCE_STORAGE_UNAVAILABLE", "剧集存储不可用", status_code=503
            )
        series_id = str(result["series"]["id"])
        episode_ids = [str(item["id"]) for item in result["episodes"]]
        legacy_repository.assign_workspace_for_series(series_id, workspace_id)
        for episode_id in episode_ids:
            legacy_repository.assign_workspace_for_script(episode_id, workspace_id)
        confirmed = repository.confirm_episode_split_preview(
            workspace_id=workspace_id,
            preview_id=preview_id,
            series_id=series_id,
            episode_ids=episode_ids,
        )
        episodes = repository.list_episode_split_episodes(
            workspace_id, series_id, episode_ids
        )
    except SourceRepositoryError:
        raise
    except Exception as exc:
        logger.exception("Source episode split confirmation failed")
        raise SourceRepositoryError(
            "SOURCE_EPISODE_SPLIT_CONFIRM_FAILED", "确认拆集失败，请稍后重试", status_code=500
        ) from exc
    record_request_event(
        request,
        action="source.episode_split.confirm",
        object_type="source_episode_split_preview",
        object_id=preview_id,
        metadata={"series_id": series_id, "episode_ids": episode_ids},
    )
    return {
        "preview_id": preview_id,
        "status": confirmed["status"],
        "source_document_id": confirmed["source_document_id"],
        "series_id": series_id,
        "episode_ids": episode_ids,
        "episodes": episodes,
    }


@router.post(
    "/sources/{source_id}/chapters/{chapter_id}/analysis",
    response_model=SourceChapterAnalysisRead,
)
@router.post(
    "/sources/{source_id}/chapters/{chapter_id}/analyze",
    response_model=SourceChapterAnalysisRead,
)
def analyze_source_chapter(
    source_id: str,
    chapter_id: str,
    request: Request,
    payload: SourceChapterAnalysisRequest | None = None,
):
    repository = _repository(request)
    workspace_id = _workspace_id(request)
    result, outcome = _run_chapter_analysis(
        request,
        repository,
        workspace_id=workspace_id,
        source_id=source_id,
        chapter_id=chapter_id,
        force=bool(payload and payload.force),
    )
    if outcome == "failed":
        raise SourceRepositoryError(
            str(result["error_code"] or "SOURCE_CHAPTER_ANALYSIS_FAILED"),
            str(result["error_message"] or "章节事件分析失败，请稍后重试"),
            status_code=502,
        )
    record_request_event(
        request,
        action="source.chapter.analysis",
        object_type="source_chapter_analysis",
        object_id=result["id"],
        metadata={"source_document_id": source_id, "chapter_id": chapter_id, "reused": result["reused"]},
    )
    return result


@router.post(
    "/sources/{source_id}/chapters/{chapter_id}/analysis/retry",
    response_model=SourceChapterAnalysisRead,
)
def retry_source_chapter_analysis(source_id: str, chapter_id: str, request: Request):
    repository = _repository(request)
    workspace_id = _workspace_id(request)
    result, outcome = _run_chapter_analysis(
        request,
        repository,
        workspace_id=workspace_id,
        source_id=source_id,
        chapter_id=chapter_id,
        force=True,
    )
    if outcome == "failed":
        raise SourceRepositoryError(
            str(result["error_code"] or "SOURCE_CHAPTER_ANALYSIS_FAILED"),
            str(result["error_message"] or "章节事件分析失败，请稍后重试"),
            status_code=502,
        )
    record_request_event(
        request,
        action="source.chapter.analysis.retry",
        object_type="source_chapter_analysis",
        object_id=result["id"],
        metadata={"source_document_id": source_id, "chapter_id": chapter_id, "retry_of": result["retry_of"]},
    )
    return result


@router.get(
    "/sources/{source_id}/chapters/{chapter_id}/analysis",
    response_model=SourceChapterAnalysisRead,
)
def get_source_chapter_analysis(source_id: str, chapter_id: str, request: Request):
    result = _repository(request).get_latest_chapter_analysis(
        _workspace_id(request), source_id, chapter_id
    )
    if result is None:
        raise SourceRepositoryError(
            "SOURCE_CHAPTER_ANALYSIS_NOT_FOUND", "章节尚未分析", status_code=404
        )
    return result


@router.get(
    "/sources/{source_id}/chapters/{chapter_id}/analysis/history",
    response_model=SourceChapterAnalysisHistory,
)
def list_source_chapter_analysis_history(source_id: str, chapter_id: str, request: Request):
    items = _repository(request).list_chapter_analysis_history(
        _workspace_id(request), source_id, chapter_id
    )
    return {"items": items, "total": len(items)}


@router.post(
    "/sources/{source_id}/analysis/batch",
    response_model=SourceAnalysisBatchRead,
    status_code=201,
)
@router.post(
    "/sources/{source_id}/chapters/analysis/batch",
    response_model=SourceAnalysisBatchRead,
    status_code=201,
)
def analyze_source_batch(
    source_id: str,
    request: Request,
    payload: SourceAnalysisBatchRequest | None = None,
):
    repository = _repository(request)
    workspace_id = _workspace_id(request)
    options = payload or SourceAnalysisBatchRequest()
    batch = repository.create_analysis_batch(
        workspace_id=workspace_id,
        source_id=source_id,
        chapter_ids=options.chapter_ids,
        user_id=_user_id(request),
    )
    result = _process_analysis_batch(
        request,
        repository,
        workspace_id=workspace_id,
        source_id=source_id,
        batch_id=str(batch["id"]),
        force=options.force,
    )
    record_request_event(
        request,
        action="source.analysis.batch",
        object_type="source_analysis_batch",
        object_id=result["id"],
        metadata={"source_document_id": source_id, "total": result["total"]},
    )
    return result


@router.get(
    "/sources/{source_id}/analysis/batches/{batch_id}",
    response_model=SourceAnalysisBatchRead,
)
def get_source_analysis_batch(source_id: str, batch_id: str, request: Request):
    result = _repository(request).get_analysis_batch(_workspace_id(request), batch_id)
    if result["source_document_id"] != source_id:
        raise SourceRepositoryError("SOURCE_ANALYSIS_BATCH_NOT_FOUND", "分析批次不存在", status_code=404)
    return result


@router.get(
    "/sources/analysis-batches/{batch_id}",
    response_model=SourceAnalysisBatchRead,
)
def get_source_analysis_batch_alias(batch_id: str, request: Request):
    return _repository(request).get_analysis_batch(_workspace_id(request), batch_id)


@router.post(
    "/sources/{source_id}/analysis/batches/{batch_id}/retry",
    response_model=SourceAnalysisBatchRead,
)
def retry_source_analysis_batch(
    source_id: str,
    batch_id: str,
    request: Request,
    payload: SourceAnalysisBatchRetryRequest | None = None,
):
    repository = _repository(request)
    workspace_id = _workspace_id(request)
    batch = repository.get_analysis_batch(workspace_id, batch_id)
    if batch["source_document_id"] != source_id:
        raise SourceRepositoryError("SOURCE_ANALYSIS_BATCH_NOT_FOUND", "分析批次不存在", status_code=404)
    chapter_ids = repository.reset_failed_analysis_batch_items(
        workspace_id=workspace_id,
        batch_id=batch_id,
        chapter_ids=payload.chapter_ids if payload else None,
    )
    result = _process_analysis_batch(
        request,
        repository,
        workspace_id=workspace_id,
        source_id=source_id,
        batch_id=batch_id,
        chapter_ids=chapter_ids,
        force=True,
    )
    record_request_event(
        request,
        action="source.analysis.batch.retry",
        object_type="source_analysis_batch",
        object_id=batch_id,
        metadata={"source_document_id": source_id, "chapter_count": len(chapter_ids)},
    )
    return result


@router.get(
    "/sources/{source_id}/impact-events",
    response_model=SourceRevisionImpactList,
)
@router.get(
    "/sources/{source_id}/impacts",
    response_model=SourceRevisionImpactList,
)
def list_source_revision_impacts(
    source_id: str,
    request: Request,
    chapter_id: str | None = Query(default=None, max_length=200),
    revision_id: str | None = Query(default=None, max_length=200),
):
    items = _repository(request).list_revision_impacts(
        _workspace_id(request),
        source_id,
        chapter_id=chapter_id,
        revision_id=revision_id,
    )
    return {"items": items, "total": len(items)}


@router.get(
    "/sources/{source_id}/chapters/{chapter_id}/impact-events",
    response_model=SourceRevisionImpactList,
)
@router.get(
    "/sources/{source_id}/chapters/{chapter_id}/impacts",
    response_model=SourceRevisionImpactList,
)
def list_chapter_revision_impacts(source_id: str, chapter_id: str, request: Request):
    items = _repository(request).list_revision_impacts(
        _workspace_id(request), source_id, chapter_id=chapter_id
    )
    return {"items": items, "total": len(items)}


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
