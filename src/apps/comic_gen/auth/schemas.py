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
    role: str


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


class RefreshResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session: SessionResponse


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class ChangePasswordResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reauthentication_required: bool = True


class PasswordResetStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    available: bool
    token_required: bool


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identifier: str = Field(min_length=1, max_length=254)
    new_password: str = Field(min_length=8, max_length=128)
    recovery_token: str | None = Field(default=None, min_length=1, max_length=512)

    @field_validator("identifier", mode="before")
    @classmethod
    def normalize_identifier(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        return unicodedata.normalize("NFKC", value.strip())


class PasswordResetResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password_reset: bool = True
    reauthentication_required: bool = True


class MeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user: UserResponse
    workspace: WorkspaceResponse
    workspaces: list[WorkspaceResponse]


class CreateWorkspaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=128)


class CreateInvitationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)


class InvitationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    workspace_id: str
    email: str
    token: str
    expires_at: str


class AcceptInvitationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=32, max_length=512)


class InvitationRegistrationRequest(SetupRequest):
    setup_token: None = None
    token: str = Field(min_length=32, max_length=512)


class WorkspaceMemberResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    username: str
    email: str
    display_name: str | None = None
    role: str
    joined_at: str


class SetupStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    initialized: bool
    setup_allowed: bool
    setup_token_required: bool


class LegacyClaimApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_source_sha256: str = Field(min_length=64, max_length=64)


class LegacyClaimSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    projects: int
    series: int
    media: int
    conflicts: int


class LegacyClaimBatchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    source_sha256: str
    status: str
    project_ids: list[str]
    series_ids: list[str]
    created_at: float
    completed_at: float
    rolled_back_at: float | None = None


class LegacyClaimResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: str
    source_sha256: str | None = None
    source_files: list[dict[str, Any]]
    summary: LegacyClaimSummaryResponse
    diagnostics: list[dict[str, Any]]
    rollback_available: bool
    batch: LegacyClaimBatchResponse | None = None
    idempotent: bool | None = None


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    message: str
    request_id: str


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    error: ErrorBody


__all__ = [
    "AcceptInvitationRequest",
    "ChangePasswordRequest",
    "ChangePasswordResponse",
    "CreateInvitationRequest",
    "CreateWorkspaceRequest",
    "ErrorResponse",
    "InvitationRegistrationRequest",
    "InvitationResponse",
    "LegacyClaimApplyRequest",
    "LegacyClaimResponse",
    "LoginRequest",
    "LoginResponse",
    "MeResponse",
    "PasswordResetRequest",
    "PasswordResetResponse",
    "PasswordResetStatusResponse",
    "RefreshResponse",
    "SetupRequest",
    "SetupResponse",
    "SetupStatusResponse",
    "UserResponse",
    "WorkspaceResponse",
    "WorkspaceMemberResponse",
]
