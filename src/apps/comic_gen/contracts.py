"""Stable cross-domain DTOs for the Studio integration boundary."""

from __future__ import annotations

import re
from functools import lru_cache
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"
    SKIPPED = "skipped"


class MediaRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    uri: str = Field(min_length=1)


class APIErrorDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    request_id: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class JobItemDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    job_id: str = Field(min_length=1)
    workspace_id: str = Field(min_length=1)
    project_id: str | None = None
    episode_id: str | None = None
    kind: str = Field(min_length=1)
    status: JobStatus = JobStatus.PENDING
    progress: float = Field(default=0.0, ge=0.0, le=1.0)
    idempotency_key: str = Field(min_length=1)
    retry_of: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    media_refs: list[MediaRef] = Field(default_factory=list)
    created_at: float | None = None
    updated_at: float | None = None
    started_at: float | None = None
    finished_at: float | None = None


class JobDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    workspace_id: str = Field(min_length=1)
    project_id: str | None = None
    episode_id: str | None = None
    kind: str = Field(min_length=1)
    status: str = Field(min_length=1)
    total: int = Field(default=0, ge=0)
    succeeded: int = Field(default=0, ge=0)
    failed: int = Field(default=0, ge=0)
    canceled: int = Field(default=0, ge=0)
    skipped: int = Field(default=0, ge=0)
    items: list[JobItemDTO] = Field(default_factory=list)
    created_at: float | None = None
    updated_at: float | None = None


class PaginatedJobs(BaseModel):
    items: list[JobDTO] = Field(default_factory=list)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    total: int = Field(default=0, ge=0)


class AcceptanceEntity(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1)
    project_id: str | None = None


class AcceptanceWorkspace(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)


class AcceptanceProject(AcceptanceEntity):
    workspace_id: str = Field(min_length=1)
    title: str = Field(min_length=1)


class AcceptanceFixture(BaseModel):
    workspace: AcceptanceWorkspace
    project: AcceptanceProject
    episodes: list[AcceptanceEntity] = Field(min_length=1)
    chapters: list[AcceptanceEntity] = Field(min_length=1)
    scenes: list[AcceptanceEntity] = Field(min_length=1)
    characters: list[AcceptanceEntity] = Field(min_length=1)


def summarize_job_items(items: list[JobItemDTO]) -> dict[str, int | str]:
    counts = {
        "total": len(items),
        "succeeded": sum(item.status is JobStatus.SUCCEEDED for item in items),
        "failed": sum(item.status is JobStatus.FAILED for item in items),
        "canceled": sum(item.status is JobStatus.CANCELED for item in items),
        "skipped": sum(item.status is JobStatus.SKIPPED for item in items),
    }
    active = sum(item.status in {JobStatus.PENDING, JobStatus.PROCESSING} for item in items)
    if active:
        status = "processing"
    elif counts["failed"] and counts["succeeded"]:
        status = "partially_succeeded"
    elif counts["failed"]:
        status = "failed"
    elif counts["canceled"] and not counts["succeeded"]:
        status = "canceled"
    elif counts["skipped"] and not counts["succeeded"]:
        status = "skipped"
    else:
        status = "succeeded"
    return {**counts, "status": status}


@lru_cache(maxsize=1)
def _vendor_model_names() -> tuple[str, ...]:
    """Upstream model names we buy capacity under, longest first.

    Taken from the catalog rather than hard-coded: it is already the list of what we call,
    and a name added there should not have to be remembered here too. Longest first so
    `gpt-image-2.5-sunburst` is removed before `gpt-image-2` can match inside it.
    """
    try:
        from ...utils.model_catalog import load_generated_model_catalog

        catalog = load_generated_model_catalog()
        names = set()
        for mode in (catalog.get("modes") or {}).values():
            for runtime in (mode.get("runtime") or {}).values():
                for key in ("api_model_id", "upstream_model", "overseas_model"):
                    value = runtime.get(key)
                    if isinstance(value, str) and len(value) > 3:
                        names.add(value)
        return tuple(sorted(names, key=len, reverse=True))
    except Exception:                       # a redaction list must never break a response
        return ()


@lru_cache(maxsize=1)
def _provider_hosts() -> tuple[str, ...]:
    """Hostnames of every provider we call, longest first.

    A scheme-less hostname is how the HTTP stack names a provider in its own errors —
    `HTTPSConnectionPool(host='...', port=443)` — so the URL rule below never caught it and
    a read timeout carried the vendor's domain straight to a customer's screen. Read from
    the endpoint registry rather than hard-coded so a provider added there is covered here.
    """
    try:
        from urllib.parse import urlparse

        from ...utils.endpoints import PROVIDER_DEFAULTS

        hosts = set()
        for url in PROVIDER_DEFAULTS.values():
            host = urlparse(url).hostname
            if host:
                hosts.add(host)
        return tuple(sorted(hosts, key=len, reverse=True))
    except Exception:                       # a redaction list must never break a response
        return ()


def sanitize_error_text(text: str) -> str:
    """Remove credentials, local paths and provider endpoints from public errors.

    Endpoints are stripped because a customer-facing failure should not disclose which
    vendors we buy capacity from or what we call — a raw client error carried the image
    relay's full URL into a user's screen. Providers raise through many different code
    paths, so this backstop sits at the boundary where errors become public rather than in
    each adapter, and keeps working for adapters written later.
    """
    redacted = re.sub(r"(?i)(?:OPENAI_API_KEY|DASHSCOPE_API_KEY|MULEROUTER_API_KEY)\s*=\s*[^\s]+", "[credential redacted]", text)
    redacted = re.sub(r"(?:[A-Za-z]:\\|/Users/|/home/|/root/)[^\s,;]+", "[local path redacted]", redacted)
    redacted = re.sub(r"(?i)\bhttps?://[^\s'\"<>]+", "[endpoint redacted]", redacted)
    # `HTTPSConnectionPool(host='...', port=443)` and friends name the host without a scheme.
    redacted = re.sub(r"(?i)\bhost\s*=\s*'[^']*'", "host='[redacted]'", redacted)
    for host in _provider_hosts():
        if host in redacted:
            redacted = redacted.replace(host, "[endpoint redacted]")
    # The vendor's model name says as much about where we buy as the endpoint does, and a
    # provider's own error text quotes it freely.
    for name in _vendor_model_names():
        if name in redacted:
            redacted = redacted.replace(name, "[model redacted]")
    return redacted


__all__ = [
    "APIErrorDTO",
    "AcceptanceFixture",
    "JobDTO",
    "JobItemDTO",
    "JobStatus",
    "MediaRef",
    "PaginatedJobs",
    "sanitize_error_text",
    "summarize_job_items",
]
