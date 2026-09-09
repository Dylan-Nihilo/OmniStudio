"""Pydantic contracts for the Source domain (SRC-00 through SRC-09)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


SourceType = Literal["text", "txt", "markdown", "docx", "paste"]


class SourceDocumentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    source_type: SourceType = "text"
    original_filename: str | None = Field(default=None, max_length=255)
    encoding: str = Field(default="utf-8", min_length=1, max_length=64)
    summary: str = Field(default="", max_length=2000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SourceDocumentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    summary: str | None = Field(default=None, max_length=2000)
    original_filename: str | None = Field(default=None, max_length=255)
    metadata: dict[str, Any] | None = None


class SourceRevisionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SourceChapterCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chapter_number: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SourceChapterUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1)


class SourceDocumentSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    workspace_id: str
    title: str
    source_type: SourceType
    original_filename: str | None
    encoding: str
    summary: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    imported_at: float | None = None
    chapter_count: int = Field(ge=0)
    linked_episode_count: int = Field(ge=0)
    created_at: float
    updated_at: float


class SourceRevisionRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    source_document_id: str
    chapter_id: str
    revision_number: int = Field(gt=0)
    content: str
    content_sha256: str
    created_by_user_id: str | None
    metadata: dict[str, Any]
    created_at: float


class SourceImpactTargetRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    impact_event_id: str
    target_type: Literal["script", "shot", "downstream"]
    target_id: str
    episode_id: str | None = None
    target_stage: str
    status: Literal["needs_review", "resolved"]
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: float


class SourceRevisionImpactRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    workspace_id: str
    source_document_id: str
    chapter_id: str
    revision_id: str
    previous_revision_id: str | None = None
    revision_number: int = Field(gt=0)
    previous_revision_number: int | None = Field(default=None, gt=0)
    change_type: Literal["chapter_edit", "revision_restore"]
    status: Literal["open", "resolved"]
    target_count: int = Field(ge=0)
    targets: list[SourceImpactTargetRead] = Field(default_factory=list)
    created_by_user_id: str | None = None
    created_at: float


class SourceRevisionImpactList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[SourceRevisionImpactRead] = Field(default_factory=list)
    total: int = Field(ge=0)


class SourceImpactAckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_ids: list[str] | None = Field(default=None, max_length=500)


class SourceChapterRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    source_document_id: str
    chapter_number: int = Field(gt=0)
    title: str
    current_revision_id: str | None
    revision_count: int = Field(ge=0)
    linked_episode_ids: list[str] = Field(default_factory=list)
    current_revision: SourceRevisionRead | None = None
    created_at: float
    updated_at: float


class SourceEpisodeRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    project_id: str
    title: str
    episode_number: int | None
    status: str
    linked_at: float


class SourceDocumentRead(SourceDocumentSummary):
    chapters: list[SourceChapterRead] = Field(default_factory=list)
    episodes: list[SourceEpisodeRead] = Field(default_factory=list)


class SourceImportConfirmResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preview_id: str
    status: Literal["confirmed"]
    source_document: SourceDocumentRead


class SourceDocumentList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[SourceDocumentSummary] = Field(default_factory=list)
    total: int = Field(ge=0)


class SourceChapterList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[SourceChapterRead] = Field(default_factory=list)
    total: int = Field(ge=0)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=100)


class SourceRevisionList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[SourceRevisionRead] = Field(default_factory=list)
    total: int = Field(ge=0)


class SourceEpisodeList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[SourceEpisodeRead] = Field(default_factory=list)
    total: int = Field(ge=0)


class SourceLinkResponse(BaseModel):
    source_document_id: str
    chapter_id: str | None = None
    episode_id: str
    created: bool
    linked: bool = True


class SourceImportRequest(BaseModel):
    """JSON form of a paste/text import; file imports use multipart instead."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    source_type: Literal["text", "txt", "markdown", "paste"] = "paste"
    content: str = Field(min_length=1)
    original_filename: str | None = Field(default=None, max_length=255)


class SourceImportChapterProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chapter_number: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=200)
    volume: str = Field(default="", max_length=200)
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    content: str = Field(min_length=1)


class SourceImportPreviewRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    workspace_id: str
    source_type: SourceType
    title: str
    original_filename: str | None
    encoding: str
    content: str
    summary: str
    content_sha256: str
    proposals: list[SourceImportChapterProposal] = Field(min_length=1)
    status: Literal["previewing", "confirmed", "canceled"]
    source_document_id: str | None
    created_at: float
    updated_at: float


class SourceEpisodeSplitProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_number: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=2000)
    start_marker: str = Field(default="", max_length=500)
    end_marker: str = Field(default="", max_length=500)
    estimated_duration: str = Field(default="", max_length=64)


class SourceEpisodeSplitPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suggested_episodes: int = Field(default=3, ge=1, le=50)


class SourceEpisodeSplitPreviewRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    workspace_id: str
    source_document_id: str
    title: str
    content_sha256: str
    suggested_episodes: int = Field(ge=1, le=50)
    proposals: list[SourceEpisodeSplitProposal] = Field(min_length=1)
    status: Literal["previewing", "confirmed", "canceled"]
    series_id: str | None = None
    episode_ids: list[str] = Field(default_factory=list)
    created_at: float
    updated_at: float


class SourceEpisodeSplitPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposals: list[SourceEpisodeSplitProposal] = Field(min_length=1, max_length=50)


class SourceEpisodeSplitConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)


class SourceEpisodeSplitCreatedEpisode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    episode_number: int
    text_length: int = Field(ge=0)


class SourceEpisodeSplitConfirmResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preview_id: str
    status: Literal["confirmed"]
    source_document_id: str
    series_id: str
    episode_ids: list[str] = Field(min_length=1)
    episodes: list[SourceEpisodeSplitCreatedEpisode] = Field(min_length=1)


class SourceChapterEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: int = Field(ge=1)
    event_type: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=2000)
    characters: list[str] = Field(default_factory=list, max_length=50)
    location: str = Field(default="", max_length=200)
    importance: Literal["low", "medium", "high"] = "medium"
    source_excerpt: str = Field(default="", max_length=1000)


class SourceChapterAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    force: bool = False


class SourceChapterAnalysisRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    workspace_id: str
    source_document_id: str
    chapter_id: str
    chapter_number: int = Field(gt=0)
    chapter_title: str
    revision_id: str
    revision_number: int = Field(gt=0)
    content_sha256: str = Field(min_length=64, max_length=64)
    status: Literal["processing", "succeeded", "failed"]
    events: list[SourceChapterEvent] = Field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    attempt: int = Field(ge=1)
    retry_of: str | None = None
    created_at: float
    updated_at: float
    finished_at: float | None = None
    reused: bool = False


class SourceChapterAnalysisHistory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[SourceChapterAnalysisRead] = Field(default_factory=list)
    total: int = Field(ge=0)


class SourceAnalysisBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chapter_ids: list[str] | None = Field(default=None, min_length=1, max_length=100)
    force: bool = False


class SourceAnalysisBatchRetryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chapter_ids: list[str] | None = Field(default=None, min_length=1, max_length=100)


class SourceAnalysisBatchItemRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    batch_id: str
    chapter_id: str
    chapter_number: int = Field(gt=0)
    chapter_title: str
    status: Literal["pending", "processing", "succeeded", "failed", "skipped"]
    analysis_id: str | None = None
    attempt: int = Field(ge=0)
    error_code: str | None = None
    error_message: str | None = None
    skip_reason: str | None = None
    created_at: float
    updated_at: float


class SourceAnalysisBatchRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    workspace_id: str
    source_document_id: str
    status: Literal["processing", "succeeded", "partially_succeeded", "failed", "skipped"]
    total: int = Field(ge=0)
    succeeded: int = Field(ge=0)
    failed: int = Field(ge=0)
    skipped: int = Field(ge=0)
    items: list[SourceAnalysisBatchItemRead] = Field(default_factory=list)
    success_items: list[SourceAnalysisBatchItemRead] = Field(default_factory=list)
    failed_items: list[SourceAnalysisBatchItemRead] = Field(default_factory=list)
    skipped_items: list[SourceAnalysisBatchItemRead] = Field(default_factory=list)
    job_id: str | None = None
    job_item_id: str | None = None
    created_at: float
    updated_at: float


class SourceImportBoundaryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposals: list["SourceImportBoundaryProposal"] = Field(min_length=1)


class SourceImportBoundaryProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chapter_number: int = Field(default=1, gt=0)
    title: str | None = Field(default=None, max_length=200)
    volume: str = Field(default="", max_length=200)
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    content: str | None = None


# Public read-model names used by the shared model import surface.
SourceDocument = SourceDocumentRead
SourceChapter = SourceChapterRead
SourceRevision = SourceRevisionRead


__all__ = [
    "SourceAnalysisBatchItemRead",
    "SourceAnalysisBatchRead",
    "SourceAnalysisBatchRequest",
    "SourceAnalysisBatchRetryRequest",
    "SourceChapterCreate",
    "SourceChapterAnalysisHistory",
    "SourceChapterAnalysisRead",
    "SourceChapterAnalysisRequest",
    "SourceChapterEvent",
    "SourceChapterUpdate",
    "SourceEpisodeSplitConfirmRequest",
    "SourceEpisodeSplitConfirmResponse",
    "SourceEpisodeSplitCreatedEpisode",
    "SourceEpisodeSplitPatch",
    "SourceEpisodeSplitPreviewRead",
    "SourceEpisodeSplitPreviewRequest",
    "SourceEpisodeSplitProposal",
    "SourceChapter",
    "SourceChapterList",
    "SourceChapterRead",
    "SourceDocumentCreate",
    "SourceDocument",
    "SourceDocumentList",
    "SourceDocumentRead",
    "SourceDocumentSummary",
    "SourceEpisodeList",
    "SourceEpisodeRead",
    "SourceLinkResponse",
    "SourceImportBoundaryPatch",
    "SourceImportBoundaryProposal",
    "SourceImportChapterProposal",
    "SourceImportConfirmResponse",
    "SourceImportPreviewRead",
    "SourceImportRequest",
    "SourceRevisionCreate",
    "SourceRevisionImpactList",
    "SourceRevisionImpactRead",
    "SourceImpactTargetRead",
    "SourceRevision",
    "SourceRevisionList",
    "SourceRevisionRead",
    "SourceType",
]
