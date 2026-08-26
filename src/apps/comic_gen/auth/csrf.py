"""CSRF primitives for the signed double-submit cookie protocol."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time


DEFAULT_WINDOW_SECONDS = 3600


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def issue_csrf_token(
    session_id: str | None,
    signing_secret: str,
    *,
    now: float | None = None,
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
) -> str:
    """Issue a signed, time-windowed double-submit token.

    ``session_id`` is ``None`` before authentication and is represented by the
    stable ``preauth`` binding.  The nonce contains the current time window so
    verification can reject stale tokens without server-side CSRF state.
    """
    if not signing_secret:
        raise ValueError("signing_secret is required")
    if window_seconds <= 0:
        raise ValueError("window_seconds must be positive")
    current = int(time.time() if now is None else now)
    window = current // int(window_seconds)
    binding = str(session_id or "preauth")
    nonce = f"{window}.{secrets.token_urlsafe(24)}"
    message = f"{binding}:{nonce}".encode("utf-8")
    signature = hmac.new(signing_secret.encode("utf-8"), message, hashlib.sha256).digest()
    return f"{_b64(nonce.encode('utf-8'))}.{_b64(signature)}"


def verify_csrf(
    token: str | None,
    session_id: str | None,
    signing_secret: str,
    *,
    now: float | None = None,
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
) -> bool:
    """Return whether a CSRF token is valid for the supplied session binding."""
    if not isinstance(token, str) or not token or not signing_secret or window_seconds <= 0:
        return False
    try:
        encoded_nonce, encoded_signature = token.split(".", 1)
        nonce = _unb64(encoded_nonce).decode("utf-8")
        signature = _unb64(encoded_signature)
        window_text, random_part = nonce.split(".", 1)
        token_window = int(window_text)
        if not random_part or len(signature) != hashlib.sha256().digest_size:
            return False
    except (ValueError, TypeError, UnicodeDecodeError, base64.binascii.Error):
        return False
    current_window = int((time.time() if now is None else now) // int(window_seconds))
    if token_window not in {current_window, current_window - 1}:
        return False
    binding = str(session_id or "preauth")
    expected = hmac.new(
        signing_secret.encode("utf-8"),
        f"{binding}:{nonce}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return hmac.compare_digest(signature, expected)


__all__ = ["DEFAULT_WINDOW_SECONDS", "issue_csrf_token", "verify_csrf"]
