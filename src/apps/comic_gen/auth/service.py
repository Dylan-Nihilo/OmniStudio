"""Business logic for Owner setup, login, and access-session validation."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import time
import unicodedata
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.exc import IntegrityError, OperationalError

from ....storage.auth_repository import AuthRepository, OwnerSetupResult
from ....storage.schema import Session, User, Workspace
from .passwords import hash_password, verify_password
from .rate_limit import InMemoryAuthRateLimiter
from .settings import AuthSettings
from .tokens import hash_refresh_token, issue_access_token, issue_refresh_token


class AuthError(Exception):
    """An expected authentication failure suitable for the API error envelope."""

    def __init__(self, code: str, message: str, *, status_code: int, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


class AuthInvalidInput(AuthError):
    def __init__(self, message: str = "认证输入不合法") -> None:
        super().__init__("AUTH_INVALID_INPUT", message, status_code=422)


@dataclass(frozen=True)
class AuthContext:
    user: User
    workspace: Workspace
    session: Session


@dataclass(frozen=True)
class AuthResult:
    user: User
    workspace: Workspace
    session: Session
    access_token: str
    refresh_token: str
    access_expires_at: float


_LOCAL_HOSTS = {"127.0.0.1", "::1"}


def normalize_username(value: str) -> tuple[str, str]:
    if not isinstance(value, str):
        raise AuthInvalidInput("username 必须是字符串")
    display = unicodedata.normalize("NFKC", value.strip())
    normalized = display.casefold()
    if not 3 <= len(normalized) <= 64:
        raise AuthInvalidInput("username 长度必须为 3-64 个字符")
    if "@" in normalized or any(ch.isspace() for ch in normalized):
        raise AuthInvalidInput("username 不得包含 @ 或空白字符")
    if any(unicodedata.category(ch).startswith("C") for ch in normalized):
        raise AuthInvalidInput("username 不得包含控制字符")
    if any(not (ch.isalnum() or ch in "._-") for ch in normalized):
        raise AuthInvalidInput("username 只能包含 Unicode 字母、数字及 ._-")
    return display, normalized


def normalize_email(value: str) -> tuple[str, str]:
    if not isinstance(value, str):
        raise AuthInvalidInput("email 必须是字符串")
    display = unicodedata.normalize("NFKC", value.strip())
    normalized = display.casefold()
    if not 3 <= len(normalized) <= 254 or "@" not in normalized:
        raise AuthInvalidInput("email 不合法")
    local, _, domain = normalized.rpartition("@")
    if not local or not domain or any(ch.isspace() for ch in normalized) or "." not in domain:
        raise AuthInvalidInput("email 不合法")
    return display, normalized


def validate_password(password: str, *, username_normalized: str, email_normalized: str) -> None:
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise AuthError("AUTH_PASSWORD_POLICY", "密码长度必须为 8-128 个字符", status_code=422)
    if password == username_normalized or password == email_normalized:
        raise AuthError("AUTH_PASSWORD_POLICY", "密码不得与用户名或邮箱相同", status_code=422)


def _request_client_ip(request: Any | None, explicit: str | None) -> str:
    if explicit:
        return explicit
    client = getattr(request, "client", None)
    return str(getattr(client, "host", "unknown") or "unknown")


def _is_local_request(request: Any | None, explicit_ip: str | None) -> bool:
    ip = _request_client_ip(request, explicit_ip)
    try:
        local = ipaddress.ip_address(ip).compressed in _LOCAL_HOSTS
    except ValueError:
        local = False
    if not local or request is None:
        return local
    headers = getattr(request, "headers", {})
    return not bool(headers.get("x-forwarded-for") or headers.get("forwarded"))


class AuthService:
    def __init__(self, repository: AuthRepository, settings: AuthSettings, *, rate_limiter: InMemoryAuthRateLimiter | None = None) -> None:
        self.repository = repository
        self.settings = settings
        self.rate_limiter = rate_limiter or InMemoryAuthRateLimiter()

    def get_setup_status(self) -> bool:
        """Read the users table on every call; this result is deliberately uncached."""
        return self.repository.count_users() > 0

    def is_local_request(self, request: Any | None, client_ip: str | None = None) -> bool:
        return _is_local_request(request, client_ip)

    def setup_user(
        self,
        username: str,
        email: str,
        password: str,
        setup_token: str | None = None,
        *,
        display_name: str | None = None,
        request: Any | None = None,
        client_ip: str | None = None,
        user_agent: str | None = None,
    ) -> AuthResult:
        ip = _request_client_ip(request, client_ip)
        decision = self.rate_limiter.check("setup:ip:" + ip, limit=5, window_seconds=600)
        if not decision.allowed:
            raise AuthError("AUTH_RATE_LIMITED", "请求过于频繁，请稍后重试", status_code=429, retry_after=decision.retry_after)
        try:
            if not _is_local_request(request, client_ip):
                configured = self.settings.setup_token
                if not configured or not isinstance(setup_token, str) or not hmac.compare_digest(setup_token, configured):
                    raise AuthError("AUTH_SETUP_FORBIDDEN", "当前来源不允许初始化", status_code=403)
            username_display, username_normalized = normalize_username(username)
            email_display, email_normalized = normalize_email(email)
            validate_password(password, username_normalized=username_normalized, email_normalized=email_normalized)
            normalized_display_name = None
            if display_name is not None:
                normalized_display_name = unicodedata.normalize("NFKC", display_name.strip()) or None
                if normalized_display_name is not None and len(normalized_display_name) > 128:
                    raise AuthInvalidInput("display_name 长度必须为 1-128 个字符")
            now = time.time()
            user_id, workspace_id, session_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
            refresh_expires_at = now + self.settings.refresh_ttl_seconds
            access_token = issue_access_token(user_id, session_id, self.settings.signing_secret, ttl_seconds=self.settings.access_ttl_seconds, now=now, expires_at=refresh_expires_at, issuer=self.settings.issuer, audience=self.settings.audience)
            refresh_token = issue_refresh_token(user_id, session_id, self.settings.signing_secret, ttl_seconds=self.settings.refresh_ttl_seconds, now=now, expires_at=refresh_expires_at, issuer=self.settings.issuer, audience=self.settings.audience)
            try:
                result = self.repository.create_owner_atomically(
                    user_values={"id": user_id, "username": username_display, "username_normalized": username_normalized, "email": email_display, "email_normalized": email_normalized, "display_name": normalized_display_name, "password_hash": hash_password(password), "created_at": now, "updated_at": now},
                    workspace_values={"id": workspace_id, "owner_user_id": user_id, "name": "LumenX Workspace", "slug": "default", "created_at": now, "updated_at": now},
                    session_values={"id": session_id, "user_id": user_id, "refresh_token_hash": hash_refresh_token(refresh_token), "rotation_counter": 0, "expires_at": refresh_expires_at, "created_at": now, "last_used_at": now, "user_agent": user_agent, "ip_address": ip},
                )
            except (ValueError, IntegrityError, OperationalError) as exc:
                if "AUTH_ALREADY_INITIALIZED" in str(exc) or isinstance(exc, IntegrityError):
                    raise AuthError("AUTH_ALREADY_INITIALIZED", "服务已经完成初始化", status_code=409) from exc
                raise
            return self._result(result, access_token, refresh_token, now)
        except AuthError:
            self.rate_limiter.record_failure("setup:ip:" + ip, window_seconds=600)
            raise

    def login(self, identifier: str, password: str, *, request: Any | None = None, client_ip: str | None = None, user_agent: str | None = None) -> AuthResult:
        ip = _request_client_ip(request, client_ip)
        normalized = unicodedata.normalize("NFKC", identifier.strip()).casefold() if isinstance(identifier, str) else ""
        identifier_key = "login:id:" + hmac.new(self.settings.signing_secret.encode("utf-8"), normalized.encode("utf-8"), hashlib.sha256).hexdigest()
        decisions = [self.rate_limiter.check("login:ip:" + ip, limit=10, window_seconds=60), self.rate_limiter.check(identifier_key, limit=5, window_seconds=900)]
        blocked = next((item for item in decisions if not item.allowed), None)
        if blocked is not None:
            raise AuthError("AUTH_RATE_LIMITED", "用户名或密码错误", status_code=429, retry_after=blocked.retry_after)
        user = self.repository.find_user_by_login(normalized) if normalized else None
        valid = verify_password(password, getattr(user, "password_hash", None))
        if not user or not valid:
            self.rate_limiter.record_failure("login:ip:" + ip, window_seconds=60)
            self.rate_limiter.record_failure(identifier_key, window_seconds=900)
            raise AuthError("AUTH_INVALID_CREDENTIALS", "用户名或密码错误", status_code=401)
        workspace = self.repository.get_default_workspace(user.id)
        if workspace is None:
            raise AuthError("AUTH_SESSION_INVALID", "登录状态无效", status_code=401)
        now = time.time()
        session_id = str(uuid.uuid4())
        refresh_expires_at = now + self.settings.refresh_ttl_seconds
        refresh_token = issue_refresh_token(user.id, session_id, self.settings.signing_secret, ttl_seconds=self.settings.refresh_ttl_seconds, now=now, expires_at=refresh_expires_at, issuer=self.settings.issuer, audience=self.settings.audience)
        access_token = issue_access_token(user.id, session_id, self.settings.signing_secret, ttl_seconds=self.settings.access_ttl_seconds, now=now, expires_at=refresh_expires_at, issuer=self.settings.issuer, audience=self.settings.audience)
        session = self.repository.create_session({"id": session_id, "user_id": user.id, "refresh_token_hash": hash_refresh_token(refresh_token), "rotation_counter": 0, "expires_at": refresh_expires_at, "created_at": now, "last_used_at": now, "user_agent": user_agent, "ip_address": ip})
        self.rate_limiter.clear(identifier_key)
        return AuthResult(user, workspace, session, access_token, refresh_token, min(now + self.settings.access_ttl_seconds, refresh_expires_at))

    def get_current_user(self, *, user_id: str, session_id: str, now: float | None = None) -> AuthContext:
        now = time.time() if now is None else now
        session = self.repository.get_session(session_id)
        if session is None or session.user_id != user_id or session.revoked_at is not None or session.expires_at <= now:
            raise AuthError("AUTH_SESSION_INVALID", "登录状态无效", status_code=401)
        user = self.repository.get_user(user_id)
        workspace = self.repository.get_default_workspace(user_id) if user else None
        if user is None or workspace is None:
            raise AuthError("AUTH_SESSION_INVALID", "登录状态无效", status_code=401)
        return AuthContext(user=user, workspace=workspace, session=session)

    def _result(self, result: OwnerSetupResult, access_token: str, refresh_token: str, now: float) -> AuthResult:
        return AuthResult(result.user, result.workspace, result.session, access_token, refresh_token, min(now + self.settings.access_ttl_seconds, result.session.expires_at))


__all__ = ["AuthContext", "AuthError", "AuthInvalidInput", "AuthResult", "AuthService", "normalize_email", "normalize_username", "validate_password"]
