"""Pydantic contracts for the Source domain (SRC-00 through SRC-06)."""

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


class SourceChapterRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    source_document_id: str
    chapter_number: int = Field(gt=0)
    title: str
    current_revision_id: str | None
    revision_count: int = Field(ge=0)
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
    "SourceChapterCreate",
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
    "SourceRevision",
    "SourceRevisionList",
    "SourceRevisionRead",
    "SourceType",
]
