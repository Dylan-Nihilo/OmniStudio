"""Authentication HTTP routes and the canonical error envelope."""

from __future__ import annotations

import hmac
import uuid
from datetime import datetime, timezone
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from .csrf import issue_csrf_token, verify_csrf
from .dependencies import ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, get_auth_service, get_current_user
from .schemas import (
    ChangePasswordRequest,
    ChangePasswordResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    PasswordResetRequest,
    PasswordResetResponse,
    PasswordResetStatusResponse,
    RefreshResponse,
    SetupRequest,
    SetupResponse,
    SetupStatusResponse,
    SessionResponse,
    UserResponse,
    WorkspaceResponse,
)
from .service import AuthContext, AuthError, AuthResult, AuthService
from .tokens import decode_access_token, decode_refresh_token

router = APIRouter(prefix="/auth", tags=["auth"])
CSRF_COOKIE_NAME = "lumenx_csrf"


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
    return WorkspaceResponse(id=str(getattr(value, "id")), name=str(getattr(value, "name")), slug=getattr(value, "slug", None))


def _session(result: AuthResult) -> SessionResponse:
    return SessionResponse(access_expires_at=_utc(result.access_expires_at), expires_at=_utc(result.session.expires_at))


def _set_csrf_cookie(response: Response, service: AuthService, *, session_id: str | None) -> None:
    response.set_cookie(
        CSRF_COOKIE_NAME,
        issue_csrf_token(session_id, service.settings.signing_secret),
        max_age=service.settings.refresh_ttl_seconds,
        httponly=False,
        secure=service.settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def _set_auth_cookies(response: Response, result: AuthResult, service: AuthService) -> None:
    secure = service.settings.cookie_secure
    response.set_cookie(ACCESS_COOKIE_NAME, result.access_token, max_age=service.settings.access_ttl_seconds, httponly=True, secure=secure, samesite="lax", path="/")
    response.set_cookie(REFRESH_COOKIE_NAME, result.refresh_token, max_age=service.settings.refresh_ttl_seconds, httponly=True, secure=secure, samesite="lax", path="/auth")
    _set_csrf_cookie(response, service, session_id=result.session.id)


def _clear_auth_cookies(response: Response, service: AuthService) -> None:
    secure = service.settings.cookie_secure
    response.delete_cookie(ACCESS_COOKIE_NAME, path="/", secure=secure, httponly=True, samesite="lax")
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/auth", secure=secure, httponly=True, samesite="lax")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/", secure=secure, httponly=False, samesite="lax")


def _auth_response(response_type: type[SetupResponse] | type[LoginResponse], result: AuthResult):
    return response_type(access_token=result.access_token, refresh_token=result.refresh_token, user=_user(result.user), workspace=_workspace(result.workspace), session=_session(result))


def _check_origin(request: Request, service: AuthService) -> None:
    origin = request.headers.get("origin")
    if not origin or origin not in service.settings.allowed_origins:
        raise AuthError("AUTH_CSRF_FAILED", "请求来源未被允许", status_code=403)


def require_csrf(request: Request, service: AuthService, *, session_id: str | None) -> None:
    _check_origin(request, service)
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    header_token = request.headers.get("x-csrf-token")
    if not cookie_token or not header_token or not hmac_compare(cookie_token, header_token):
        raise AuthError("AUTH_CSRF_FAILED", "CSRF 校验失败", status_code=403)
    if not verify_csrf(cookie_token, session_id, service.settings.signing_secret):
        raise AuthError("AUTH_CSRF_FAILED", "CSRF 校验失败", status_code=403)


def hmac_compare(left: str, right: str) -> bool:
    return hmac.compare_digest(left, right)


def _unverified_session_id(token: str | None) -> str | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
        sid = payload.get("sid") if isinstance(payload, dict) else None
        return str(sid) if sid else None
    except Exception:
        return None


def _verified_session_id(
    token: str | None,
    service: AuthService,
    *,
    token_type: str,
) -> str | None:
    """Return sid only after strict JWT validation; logout remains non-oracular."""
    if not token:
        return None
    decoder = decode_access_token if token_type == "access" else decode_refresh_token
    try:
        payload = decoder(
            token,
            service.settings.signing_secret,
            issuer=service.settings.issuer,
            audience=service.settings.audience,
        )
    except Exception:
        return None
    return str(payload["sid"])


def auth_exception_handler(request: Request, exc: AuthError) -> JSONResponse:
    request_id = str(getattr(request.state, "request_id", "") or f"req_{uuid.uuid4().hex}")
    headers = {"Cache-Control": "no-store"}
    if exc.retry_after is not None:
        headers["Retry-After"] = str(exc.retry_after)
    result = JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message, "request_id": request_id}}, headers=headers)
    if getattr(request.state, "clear_auth_cookies", False):
        service = getattr(request.app.state, "auth_service", None)
        if service is not None:
            _clear_auth_cookies(result, service)
    return result


@router.get("/setup-status", response_model=SetupStatusResponse)
def setup_status(request: Request, response: Response, service: Annotated[AuthService, Depends(get_auth_service)]) -> SetupStatusResponse:
    initialized = service.get_setup_status()
    local = service.is_local_request(request)
    _set_csrf_cookie(response, service, session_id=None)
    response.headers["Cache-Control"] = "no-store"
    return SetupStatusResponse(initialized=initialized, setup_allowed=not initialized and (local or bool(service.settings.setup_token)), setup_token_required=not initialized and not local)


@router.post("/setup", response_model=SetupResponse, status_code=201)
def setup(request: Request, payload: SetupRequest, response: Response, service: Annotated[AuthService, Depends(get_auth_service)]) -> SetupResponse:
    try:
        require_csrf(request, service, session_id=None)
    except AuthError:
        # A repeated setup from an already authenticated browser may still
        # carry a session-bound CSRF cookie.  Validate that binding too, then
        # let the service return the stable already-initialized response.
        sid = _unverified_session_id(request.cookies.get(ACCESS_COOKIE_NAME))
        if not sid:
            raise
        require_csrf(request, service, session_id=sid)
    result = service.setup_user(payload.username, str(payload.email), payload.password, payload.setup_token, display_name=payload.display_name, request=request, user_agent=request.headers.get("user-agent"))
    _set_auth_cookies(response, result, service)
    response.headers["Cache-Control"] = "no-store"
    return _auth_response(SetupResponse, result)


@router.post("/login", response_model=LoginResponse)
def login(request: Request, payload: LoginRequest, response: Response, service: Annotated[AuthService, Depends(get_auth_service)]) -> LoginResponse:
    try:
        require_csrf(request, service, session_id=None)
    except AuthError:
        # A browser that was logged in (or whose session just expired) still
        # carries a session-bound CSRF cookie.  Validate against that binding
        # too so re-login after session expiry does not 403.  The HMAC
        # signature is still required, so accepting both bindings does not
        # weaken the CSRF protection.
        sid = _unverified_session_id(request.cookies.get(ACCESS_COOKIE_NAME)) or _unverified_session_id(
            request.cookies.get(REFRESH_COOKIE_NAME)
        )
        if not sid:
            raise
        require_csrf(request, service, session_id=sid)
    result = service.login(payload.identifier, payload.password, request=request, user_agent=request.headers.get("user-agent"))
    _set_auth_cookies(response, result, service)
    response.headers["Cache-Control"] = "no-store"
    return _auth_response(LoginResponse, result)


@router.post("/refresh", response_model=RefreshResponse)
def refresh(request: Request, response: Response, service: Annotated[AuthService, Depends(get_auth_service)]) -> RefreshResponse:
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    sid = _unverified_session_id(token) or _unverified_session_id(
        request.cookies.get(ACCESS_COOKIE_NAME)
    )
    require_csrf(request, service, session_id=sid)
    if not token:
        request.state.clear_auth_cookies = True
        raise AuthError("AUTH_SESSION_INVALID", "登录状态无效", status_code=401)
    try:
        result = service.refresh_session(token)
    except AuthError:
        request.state.clear_auth_cookies = True
        raise
    _set_auth_cookies(response, result, service)
    response.headers["Cache-Control"] = "no-store"
    return RefreshResponse(session=_session(result))


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, service: Annotated[AuthService, Depends(get_auth_service)]) -> Response:
    access = request.cookies.get(ACCESS_COOKIE_NAME)
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    csrf_sid = _unverified_session_id(refresh_token) or _unverified_session_id(access)
    if access or refresh_token:
        require_csrf(request, service, session_id=csrf_sid)
        session_id = _verified_session_id(access, service, token_type="access") or _verified_session_id(
            refresh_token, service, token_type="refresh"
        )
        if session_id:
            service.logout(session_id)
    _clear_auth_cookies(response, service)
    response.headers["Cache-Control"] = "no-store"
    response.status_code = 204
    return response


@router.get("/password-reset/status", response_model=PasswordResetStatusResponse)
def password_reset_status(
    request: Request,
    response: Response,
    service: Annotated[AuthService, Depends(get_auth_service)],
) -> PasswordResetStatusResponse:
    local = service.is_local_request(request)
    available = local and service.get_setup_status()
    _set_csrf_cookie(response, service, session_id=None)
    response.headers["Cache-Control"] = "no-store"
    return PasswordResetStatusResponse(
        available=available,
        token_required=available and bool(service.settings.password_reset_token),
    )


@router.post("/password-reset", response_model=PasswordResetResponse)
def password_reset(
    request: Request,
    response: Response,
    payload: PasswordResetRequest,
    service: Annotated[AuthService, Depends(get_auth_service)],
) -> PasswordResetResponse:
    try:
        require_csrf(request, service, session_id=None)
    except AuthError:
        sid = _unverified_session_id(request.cookies.get(ACCESS_COOKIE_NAME)) or _unverified_session_id(
            request.cookies.get(REFRESH_COOKIE_NAME)
        )
        if not sid:
            raise
        require_csrf(request, service, session_id=sid)
    service.reset_password(
        payload.identifier,
        payload.new_password,
        payload.recovery_token,
        request=request,
    )
    _clear_auth_cookies(response, service)
    response.headers["Cache-Control"] = "no-store"
    return PasswordResetResponse()


@router.post("/change-password", response_model=ChangePasswordResponse)
def change_password(request: Request, response: Response, payload: ChangePasswordRequest, context: Annotated[AuthContext, Depends(get_current_user)], service: Annotated[AuthService, Depends(get_auth_service)]) -> ChangePasswordResponse:
    require_csrf(request, service, session_id=context.session.id)
    service.change_password(context.user.id, payload.current_password, payload.new_password)
    _clear_auth_cookies(response, service)
    response.headers["Cache-Control"] = "no-store"
    return ChangePasswordResponse(reauthentication_required=True)


@router.get("/me", response_model=MeResponse)
def me(context: Annotated[AuthContext, Depends(get_current_user)]) -> MeResponse:
    return MeResponse(user=_user(context.user), workspace=_workspace(context.workspace))


__all__ = ["CSRF_COOKIE_NAME", "auth_exception_handler", "require_csrf", "router"]
