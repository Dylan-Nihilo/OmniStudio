"""Pydantic v2 contracts for the W3.2 authentication API."""

from __future__ import annotations

import unicodedata
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SetupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=128)
    email: str
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=128)
    setup_token: str | None = Field(default=None, min_length=1)

    @field_validator("username", "display_name", mode="before")
    @classmethod
    def normalize_text(cls, value: Any) -> Any:
        if value is None or not isinstance(value, str):
            return value
        return unicodedata.normalize("NFKC", value.strip())

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        return unicodedata.normalize("NFKC", value.strip())


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identifier: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("identifier", mode="before")
    @classmethod
    def normalize_identifier(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        return unicodedata.normalize("NFKC", value.strip())


class UserResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    username: str
    email: str
    display_name: str | None = None
    created_at: str


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    slug: str | None = None


class SessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    access_expires_at: str
    expires_at: str


class SetupResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    access_token: str
    refresh_token: str
    user: UserResponse
    workspace: WorkspaceResponse
    session: SessionResponse


class LoginResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    access_token: str
    refresh_token: str
    user: UserResponse
    workspace: WorkspaceResponse
    session: SessionResponse


class MeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user: UserResponse
    workspace: WorkspaceResponse


class SetupStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    initialized: bool
    setup_allowed: bool
    setup_token_required: bool


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    message: str
    request_id: str


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    error: ErrorBody


__all__ = ["ErrorResponse", "LoginRequest", "LoginResponse", "MeResponse", "SetupRequest", "SetupResponse", "SetupStatusResponse", "UserResponse", "WorkspaceResponse"]
