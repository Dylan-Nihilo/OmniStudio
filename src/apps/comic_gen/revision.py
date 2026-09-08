"""Deterministic content revisions and dependency freshness checks."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")


def compute_revision(payload: Any) -> str:
    """Return a stable SHA-256 revision for a JSON-compatible payload."""
    return hashlib.sha256(_canonical_json(payload)).hexdigest()


def compute_dependency_fingerprint(
    kind: str,
    refs: Mapping[str, Any] | None = None,
    params: Mapping[str, Any] | None = None,
) -> str:
    """Hash only the declared references and generation parameters."""
    return compute_revision({"kind": kind, "refs": dict(refs or {}), "params": dict(params or {})})


def evaluate_stale(
    current_revision: str | None,
    stored_revision: str | None,
    current_fingerprint: str | None,
    stored_fingerprint: str | None,
) -> bool:
    """Mark stale when either the source revision or declared dependencies differ."""
    return (
        not current_revision
        or not stored_revision
        or not current_fingerprint
        or not stored_fingerprint
        or current_revision != stored_revision
        or current_fingerprint != stored_fingerprint
    )


__all__ = ["compute_dependency_fingerprint", "compute_revision", "evaluate_stale"]
