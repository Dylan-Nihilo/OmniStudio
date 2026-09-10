"""Effective model-setting resolution across the Studio ownership layers."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, Mapping

from .models import ModelSettings

MODEL_SETTING_FIELDS = tuple(ModelSettings.model_fields)
WORKSPACE_MODEL_SETTINGS_KEY = "__model_settings"


@dataclass(frozen=True)
class ResolvedModelSettings:
    settings: ModelSettings
    sources: dict[str, str]


def _as_mapping(value: ModelSettings | Mapping[str, Any] | None) -> Mapping[str, Any]:
    if value is None:
        return {}
    if isinstance(value, ModelSettings):
        return value.model_dump()
    return value


def resolve_model_settings(
    global_settings: ModelSettings | Mapping[str, Any] | None = None,
    project_settings: ModelSettings | Mapping[str, Any] | None = None,
    episode_overrides: Mapping[str, Any] | None = None,
    shot_overrides: Mapping[str, Any] | None = None,
) -> ResolvedModelSettings:
    """Merge global -> Project -> Episode -> Shot settings deterministically.

    Layers only replace fields they explicitly contain.  This is deliberately
    mapping-based so older payloads with a complete ``ModelSettings`` snapshot
    remain readable while new records can persist sparse override maps.
    """
    base = ModelSettings.model_validate(_as_mapping(global_settings) or {})
    values = base.model_dump()
    sources = {field: "global" for field in MODEL_SETTING_FIELDS}
    for source_name, layer in (
        ("project", project_settings),
        ("episode", episode_overrides),
        ("shot", shot_overrides),
    ):
        for field, value in _as_mapping(layer).items():
            if field not in values or value is None:
                continue
            values[field] = value
            sources[field] = source_name
    return ResolvedModelSettings(ModelSettings.model_validate(values), sources)


def load_workspace_model_settings(config: Mapping[str, Any] | None) -> ModelSettings:
    """Decode model defaults stored inside the Workspace configuration row."""
    raw: Any = (config or {}).get(WORKSPACE_MODEL_SETTINGS_KEY, {})
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            raw = {}
    try:
        return ModelSettings.model_validate(raw or {})
    except (TypeError, ValueError):
        return ModelSettings()


def sparse_model_settings(value: ModelSettings | Mapping[str, Any] | None) -> dict[str, Any]:
    """Keep only fields that differ from catalog defaults for legacy migration."""
    candidate = ModelSettings.model_validate(_as_mapping(value) or {}).model_dump()
    defaults = ModelSettings().model_dump()
    return {field: field_value for field, field_value in candidate.items() if field_value != defaults[field]}


__all__ = [
    "MODEL_SETTING_FIELDS",
    "ResolvedModelSettings",
    "WORKSPACE_MODEL_SETTINGS_KEY",
    "load_workspace_model_settings",
    "resolve_model_settings",
    "sparse_model_settings",
]
