"""JWT access/refresh token primitives for Omni Studio W3."""

from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any, Mapping

import jwt

ISSUER = "omni_studio"
AUDIENCE = "omni-studio"
ALGORITHM = "HS256"
JWT_LEEWAY_SECONDS = 30
_REQUIRED_CLAIMS = ["exp", "iat", "nbf", "sub", "sid", "jti", "type", "iss", "aud"]


class TokenError(jwt.InvalidTokenError):
    """Raised when a signed token is structurally valid but unusable here."""


def _issue(
    user_id: str,
    session_id: str,
    signing_secret: str,
    token_type: str,
    *,
    ttl_seconds: int,
    now: float | None = None,
    expires_at: float | None = None,
    rotation_counter: int | None = None,
    issuer: str = ISSUER,
    audience: str = AUDIENCE,
    jti: str | None = None,
) -> str:
    issued_at = int(time.time() if now is None else now)
    candidate_exp = issued_at + int(ttl_seconds)
    exp = min(candidate_exp, int(expires_at)) if expires_at is not None else candidate_exp
    if exp <= issued_at:
        raise ValueError("token expiry must be after issued_at")
    claims: dict[str, Any] = {
        "iss": issuer,
        "aud": audience,
        "sub": str(user_id),
        "sid": str(session_id),
        "jti": jti or str(uuid.uuid4()),
        "type": token_type,
        "iat": issued_at,
        "nbf": issued_at,
        "exp": exp,
    }
    if rotation_counter is not None:
        claims["rot"] = int(rotation_counter)
    return str(jwt.encode(claims, signing_secret, algorithm=ALGORITHM))


def issue_access_token(
    user_id: str,
    session_id: str,
    signing_secret: str,
    *,
    ttl_seconds: int = 900,
    now: float | None = None,
    expires_at: float | None = None,
    issuer: str = ISSUER,
    audience: str = AUDIENCE,
    jti: str | None = None,
) -> str:
    return _issue(
        user_id,
        session_id,
        signing_secret,
        "access",
        ttl_seconds=ttl_seconds,
        now=now,
        expires_at=expires_at,
        issuer=issuer,
        audience=audience,
        jti=jti,
    )


def issue_refresh_token(
    user_id: str,
    session_id: str,
    signing_secret: str,
    *,
    rotation_counter: int = 0,
    ttl_seconds: int = 1209600,
    now: float | None = None,
    expires_at: float | None = None,
    issuer: str = ISSUER,
    audience: str = AUDIENCE,
    jti: str | None = None,
) -> str:
    return _issue(
        user_id,
        session_id,
        signing_secret,
        "refresh",
        ttl_seconds=ttl_seconds,
        now=now,
        expires_at=expires_at,
        rotation_counter=rotation_counter,
        issuer=issuer,
        audience=audience,
        jti=jti,
    )


def _decode(token: str, signing_secret: str, expected_type: str, *, issuer: str, audience: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            signing_secret,
            algorithms=[ALGORITHM],
            issuer=issuer,
            audience=audience,
            options={"require": _REQUIRED_CLAIMS},
            leeway=JWT_LEEWAY_SECONDS,
        )
    except jwt.InvalidTokenError:
        raise
    if not isinstance(payload, Mapping) or payload.get("type") != expected_type:
        raise TokenError(f"expected {expected_type} token")
    for claim in ("sub", "sid", "jti"):
        if not isinstance(payload.get(claim), str) or not payload[claim]:
            raise TokenError(f"invalid {claim} claim")
    return dict(payload)


def decode_access_token(
    token: str,
    signing_secret: str,
    *,
    issuer: str = ISSUER,
    audience: str = AUDIENCE,
) -> dict[str, Any]:
    return _decode(token, signing_secret, "access", issuer=issuer, audience=audience)


def decode_refresh_token(
    token: str,
    signing_secret: str,
    *,
    issuer: str = ISSUER,
    audience: str = AUDIENCE,
) -> dict[str, Any]:
    payload = _decode(token, signing_secret, "refresh", issuer=issuer, audience=audience)
    rotation = payload.get("rot")
    if isinstance(rotation, bool) or not isinstance(rotation, int) or rotation < 0:
        raise TokenError("refresh token has an invalid rotation counter")
    return payload


def hash_refresh_token(token: str) -> str:
    if not isinstance(token, str) or not token:
        raise ValueError("refresh token must be a non-empty string")
    return "sha256:" + hashlib.sha256(token.encode("utf-8")).hexdigest()


__all__ = [
    "ALGORITHM",
    "AUDIENCE",
    "ISSUER",
    "TokenError",
    "decode_access_token",
    "decode_refresh_token",
    "hash_refresh_token",
    "issue_access_token",
    "issue_refresh_token",
]
