"""Authentication HTTP routes and the canonical error envelope."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from .dependencies import ACCESS_COOKIE_NAME, get_auth_service, get_current_user
from .schemas import (
    LoginRequest,
    LoginResponse,
    MeResponse,
    SetupRequest,
    SetupResponse,
    SetupStatusResponse,
    SessionResponse,
    UserResponse,
    WorkspaceResponse,
)
from .service import AuthContext, AuthError, AuthResult, AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


def _utc(value: float) -> str:
    return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _user(value: object) -> UserResponse:
    return UserResponse(
        id=str(getattr(value, "id")),
        username=str(getattr(value, "username")),
        email=str(getattr(value, "email")),
        display_name=getattr(value, "display_name", None),
        created_at=_utc(float(getattr(value, "created_at"))),
    )


def _workspace(value: object) -> WorkspaceResponse:
    return WorkspaceResponse(
        id=str(getattr(value, "id")),
        name=str(getattr(value, "name")),
        slug=getattr(value, "slug", None),
    )


def _session(result: AuthResult) -> SessionResponse:
    return SessionResponse(
        access_expires_at=_utc(result.access_expires_at),
        expires_at=_utc(result.session.expires_at),
    )


def _set_auth_cookies(response: Response, result: AuthResult, service: AuthService) -> None:
    """Keep tokens in HttpOnly cookies; JSON token fields are compatibility-only.

    Browsers should ignore the response-body token strings and use the cookies.
    Returning them remains useful for CLI/native clients and TestClient-based
    integration tests, while the browser path never needs JavaScript access to
    either credential.
    """
    secure = service.settings.cookie_secure
    response.set_cookie(
        ACCESS_COOKIE_NAME,
        result.access_token,
        max_age=service.settings.access_ttl_seconds,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        "lumenx_refresh",
        result.refresh_token,
        max_age=service.settings.refresh_ttl_seconds,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/auth",
    )


def _auth_response(response_type: type[SetupResponse] | type[LoginResponse], result: AuthResult):
    return response_type(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        user=_user(result.user),
        workspace=_workspace(result.workspace),
        session=_session(result),
    )


def auth_exception_handler(request: Request, exc: AuthError) -> JSONResponse:
    request_id = str(getattr(request.state, "request_id", "") or f"req_{uuid.uuid4().hex}")
    headers = {"Cache-Control": "no-store"}
    if exc.retry_after is not None:
        headers["Retry-After"] = str(exc.retry_after)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "request_id": request_id,
            }
        },
        headers=headers,
    )


@router.get("/setup-status", response_model=SetupStatusResponse)
def setup_status(
    request: Request,
    response: Response,
    service: Annotated[AuthService, Depends(get_auth_service)],
) -> SetupStatusResponse:
    """Return uncached initialization state without revealing setup secrets."""
    initialized = service.get_setup_status()
    local = service.is_local_request(request)
    response.headers["Cache-Control"] = "no-store"
    return SetupStatusResponse(
        initialized=initialized,
        setup_allowed=not initialized and (local or bool(service.settings.setup_token)),
        setup_token_required=not initialized and not local,
    )


@router.post("/setup", response_model=SetupResponse, status_code=201)
def setup(
    request: Request,
    payload: SetupRequest,
    response: Response,
    service: Annotated[AuthService, Depends(get_auth_service)],
) -> SetupResponse:
    """Create the first owner and set HttpOnly cookies.

    Browsers use the cookies as the primary credential transport. The JSON
    token fields are retained for CLI/native clients and TestClient-based
    integration tests; browser JavaScript does not need to read them.
    """
    result = service.setup_user(
        payload.username,
        str(payload.email),
        payload.password,
        payload.setup_token,
        display_name=payload.display_name,
        request=request,
        user_agent=request.headers.get("user-agent"),
    )
    _set_auth_cookies(response, result, service)
    response.headers["Cache-Control"] = "no-store"
    return _auth_response(SetupResponse, result)


@router.post("/login", response_model=LoginResponse)
def login(
    request: Request,
    payload: LoginRequest,
    response: Response,
    service: Annotated[AuthService, Depends(get_auth_service)],
) -> LoginResponse:
    """Log in and set HttpOnly cookies; JSON tokens are CLI/test compatibility fields."""
    result = service.login(
        payload.identifier,
        payload.password,
        request=request,
        user_agent=request.headers.get("user-agent"),
    )
    _set_auth_cookies(response, result, service)
    response.headers["Cache-Control"] = "no-store"
    return _auth_response(LoginResponse, result)


@router.get("/me", response_model=MeResponse)
def me(context: Annotated[AuthContext, Depends(get_current_user)]) -> MeResponse:
    return MeResponse(user=_user(context.user), workspace=_workspace(context.workspace))


__all__ = ["auth_exception_handler", "router"]
