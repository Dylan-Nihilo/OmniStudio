"""Structured classification for errors raised by external AI providers.

The provider wrappers intentionally remain thin: they can translate transport
exceptions with :func:`raise_classified`, while the API layer can render one
stable error shape for clients.
"""

from __future__ import annotations

import re
import socket
from enum import Enum
from typing import NoReturn, Optional

import requests

try:  # httpx is an optional/runtime dependency for some provider adapters.
    import httpx
except ImportError:  # pragma: no cover - exercised only in minimal installs
    httpx = None  # type: ignore[assignment]

try:
    from urllib3.exceptions import (
        ConnectTimeoutError as Urllib3ConnectTimeoutError,
        MaxRetryError as Urllib3MaxRetryError,
        NewConnectionError as Urllib3NewConnectionError,
        ProtocolError as Urllib3ProtocolError,
        ReadTimeoutError as Urllib3ReadTimeoutError,
        SSLError as Urllib3SSLError,
    )
except ImportError:  # pragma: no cover - requests normally brings urllib3
    Urllib3ConnectTimeoutError = ()  # type: ignore[assignment]
    Urllib3MaxRetryError = ()  # type: ignore[assignment]
    Urllib3NewConnectionError = ()  # type: ignore[assignment]
    Urllib3ProtocolError = ()  # type: ignore[assignment]
    Urllib3ReadTimeoutError = ()  # type: ignore[assignment]
    Urllib3SSLError = ()  # type: ignore[assignment]


class ProviderErrorCategory(str, Enum):
    """Stable categories exposed to the frontend/API clients."""

    NETWORK = "network"
    AUTH = "auth"
    QUOTA = "quota"
    MODEL_UNAVAILABLE = "model_unavailable"
    UNKNOWN = "unknown"


_CATEGORY_STATUS_CODES = {
    ProviderErrorCategory.NETWORK: 503,
    ProviderErrorCategory.AUTH: 502,
    ProviderErrorCategory.QUOTA: 429,
    ProviderErrorCategory.MODEL_UNAVAILABLE: 502,
    ProviderErrorCategory.UNKNOWN: 500,
}


class ProviderError(Exception):
    """A provider failure with a category and HTTP status for API rendering.

    Positional construction follows the field order used by the PRD:
    ``ProviderError(category, provider, status_code, detail)``.  ``status_code``
    may be omitted when constructing one manually; in that case the standard
    category mapping is used.
    """

    def __init__(
        self,
        category: ProviderErrorCategory,
        provider: Optional[str] = None,
        status_code: Optional[int] = None,
        detail: str = "",
    ) -> None:
        self.category = ProviderErrorCategory(category)
        self.provider = provider
        self.status_code = int(
            _CATEGORY_STATUS_CODES[self.category]
            if status_code is None
            else status_code
        )
        self.detail = detail or self.category.value

        provider_label = f" [{provider}]" if provider else ""
        super().__init__(
            f"Provider error{provider_label} ({self.category.value}): {self.detail}"
        )


def _status_code_from_exception(exc: Exception) -> Optional[int]:
    """Get an upstream status code, preferring an attached response."""

    response = getattr(exc, "response", None)
    status_code = getattr(response, "status_code", None)
    if status_code is None:
        status_code = getattr(exc, "status_code", None)

    try:
        return int(status_code) if status_code is not None else None
    except (TypeError, ValueError):
        return None


def _is_openai_error(exc: Exception, class_name: str) -> bool:
    """Recognize OpenAI errors without making OpenAI a hard import requirement."""

    if exc.__class__.__name__ != class_name:
        return False
    module = exc.__class__.__module__
    return module == "openai" or module.startswith("openai.")


def _is_httpx_error(exc: Exception, class_name: str) -> bool:
    if httpx is None:
        return False
    error_type = getattr(httpx, class_name, None)
    return error_type is not None and isinstance(exc, error_type)


def _is_network_error(exc: Exception) -> bool:
    network_types = (
        requests.exceptions.ConnectionError,
        requests.exceptions.ConnectTimeout,
        requests.exceptions.ReadTimeout,
        requests.exceptions.Timeout,
        socket.timeout,
        OSError,
        Urllib3ConnectTimeoutError,
        Urllib3MaxRetryError,
        Urllib3NewConnectionError,
        Urllib3ProtocolError,
        Urllib3ReadTimeoutError,
        Urllib3SSLError,
    )
    if isinstance(exc, network_types):
        return True

    return any(
        _is_httpx_error(exc, name)
        for name in ("ConnectError", "ReadTimeout", "ConnectTimeout", "TimeoutException")
    )


_AUTH_MESSAGE_RE = re.compile(
    r"invalid\s*api[-_ ]?key|authentication|unauthori[sz]ed|unauthenticated|"
    r"invalid\s+(?:api[-_ ]?key|credential)|access\s+denied|forbidden",
    re.IGNORECASE,
)
_QUOTA_MESSAGE_RE = re.compile(
    r"quota|insufficient|balance|limit|exceeded|rate\s*limit|too\s*many\s*requests",
    re.IGNORECASE,
)
_MODEL_MESSAGE_RE = re.compile(
    r"model.*(?:not\s+(?:exist|found)|does\s+not\s+exist)|"
    r"not\s+found|unsupported",
    re.IGNORECASE,
)


def classify_provider_error(
    exc: Exception, provider: Optional[str] = None
) -> ProviderError:
    """Classify a provider exception into a stable :class:`ProviderError`."""

    if isinstance(exc, ProviderError):
        return exc

    status_code = _status_code_from_exception(exc)
    message = str(exc).strip() or exc.__class__.__name__

    # HTTP status is intentionally checked before exception type/message.  A
    # response status is the most authoritative signal when one is available.
    if status_code in (401, 403):
        category = ProviderErrorCategory.AUTH
    elif status_code in (402, 429):
        category = ProviderErrorCategory.QUOTA
    elif status_code == 404:
        category = ProviderErrorCategory.MODEL_UNAVAILABLE
    elif _is_openai_error(exc, "AuthenticationError"):
        category = ProviderErrorCategory.AUTH
    elif _is_openai_error(exc, "RateLimitError"):
        category = ProviderErrorCategory.QUOTA
    elif status_code is None and _is_network_error(exc):
        category = ProviderErrorCategory.NETWORK
    elif _AUTH_MESSAGE_RE.search(message):
        category = ProviderErrorCategory.AUTH
    elif _QUOTA_MESSAGE_RE.search(message):
        category = ProviderErrorCategory.QUOTA
    elif _MODEL_MESSAGE_RE.search(message) or (
        status_code == 400
        and "model" in message.lower()
        and "invalid parameter" in message.lower()
    ):
        category = ProviderErrorCategory.MODEL_UNAVAILABLE
    else:
        category = ProviderErrorCategory.UNKNOWN

    return ProviderError(
        category=category,
        provider=provider,
        status_code=_CATEGORY_STATUS_CODES[category],
        detail=message,
    )


def raise_classified(
    exc: Exception, provider: Optional[str] = None
) -> NoReturn:
    """Raise a classified provider error from an arbitrary exception."""

    raise classify_provider_error(exc, provider)
