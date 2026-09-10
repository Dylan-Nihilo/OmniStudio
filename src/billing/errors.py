"""Billing error envelope, mirrors AuthError so the API layer can map it uniformly."""

from __future__ import annotations


class BillingError(Exception):
    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


__all__ = ["BillingError"]
