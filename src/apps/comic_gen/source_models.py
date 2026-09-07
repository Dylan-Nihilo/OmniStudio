"""Pydantic contracts for the Source domain (SRC-00)."""

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


class SourceDocumentList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[SourceDocumentSummary] = Field(default_factory=list)
    total: int = Field(ge=0)


class SourceChapterList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[SourceChapterRead] = Field(default_factory=list)
    total: int = Field(ge=0)


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


# Public read-model names used by the shared model import surface.
SourceDocument = SourceDocumentRead
SourceChapter = SourceChapterRead
SourceRevision = SourceRevisionRead


__all__ = [
    "SourceChapterCreate",
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
    "SourceRevisionCreate",
    "SourceRevision",
    "SourceRevisionList",
    "SourceRevisionRead",
    "SourceType",
]
