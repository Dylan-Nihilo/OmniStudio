"""FastAPI dependencies for application-scoped authentication services."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from ....storage.auth_repository import AuthRepository
from .service import AuthContext, AuthError, AuthService
from .settings import AuthSettings
from .tokens import decode_access_token

ACCESS_COOKIE_NAME = "omni_studio_access"
REFRESH_COOKIE_NAME = "omni_studio_refresh"


def get_auth_service(request: Request) -> AuthService:
    """Return the application singleton; tests can override this dependency."""
    service = getattr(request.app.state, "auth_service", None)
    if service is not None:
        return service
    engine = getattr(request.app.state, "storage_engine", None)
    if engine is None:
        raise RuntimeError("Auth service is not configured: application has no storage engine")
    settings = getattr(request.app.state, "auth_settings", None) or AuthSettings.from_env(engine=engine)
    service = AuthService(AuthRepository(engine), settings)
    request.app.state.auth_settings = settings
    request.app.state.auth_service = service
    return service


def _authorization_token(request: Request) -> str | None:
    value = request.headers.get("authorization")
    if not value:
        return None
    scheme, separator, credentials = value.partition(" ")
    if scheme.lower() != "bearer" or not separator or not credentials.strip():
        raise AuthError("AUTH_SESSION_INVALID", "登录状态无效", status_code=401)
    return credentials.strip()


def _access_token_from_request(request: Request) -> str:
    cookie_token = request.cookies.get(ACCESS_COOKIE_NAME)
    header_token = _authorization_token(request)
    if cookie_token and header_token and cookie_token != header_token:
        raise AuthError("AUTH_AMBIGUOUS_CREDENTIALS", "请求包含相互冲突的认证凭据", status_code=400)
    token = cookie_token or header_token
    if not token:
        raise AuthError("AUTH_SESSION_INVALID", "登录状态无效", status_code=401)
    return token


def get_current_user(request: Request, service: Annotated[AuthService, Depends(get_auth_service)]) -> AuthContext:
    """Return middleware-authenticated context or validate access + live session."""
    existing = getattr(request.state, "auth_context", None)
    if existing is not None:
        return existing
    token = _access_token_from_request(request)
    try:
        payload = decode_access_token(token, service.settings.signing_secret, issuer=service.settings.issuer, audience=service.settings.audience)
    except Exception as exc:
        raise AuthError("AUTH_SESSION_INVALID", "登录状态无效", status_code=401) from exc
    return service.get_current_user(user_id=payload["sub"], session_id=payload["sid"])


def get_optional_current_user(request: Request, service: Annotated[AuthService, Depends(get_auth_service)]) -> AuthContext | None:
    """Return no context when no credential was supplied, but reject bad ones."""
    if not request.cookies.get(ACCESS_COOKIE_NAME) and not request.headers.get("authorization"):
        return None
    return get_current_user(request, service)


__all__ = ["ACCESS_COOKIE_NAME", "REFRESH_COOKIE_NAME", "get_auth_service", "get_current_user", "get_optional_current_user"]
