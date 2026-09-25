"""Shared aspect-ratio rules for Studio generation and export."""

from __future__ import annotations

import re
from math import gcd
from typing import Any, Dict, Optional, Tuple


ASPECT_RATIOS: Tuple[str, ...] = ("9:16", "16:9", "1:1")
_EXPORT_RESOLUTIONS = {
    "9:16": ("1080x1920", "720x1280"),
    "16:9": ("1920x1080", "1280x720", "640x360"),
    "1:1": ("1080x1080", "720x720"),
}
_RESOLUTION_RE = re.compile(r"^(\d{2,5})x(\d{2,5})$")


def resolve_master_aspect_ratio(settings: Any) -> str:
    """Return the effective output ratio from model settings."""

    value = getattr(settings, "storyboard_aspect_ratio", None)
    return value if value in ASPECT_RATIOS else "16:9"


def resolve_video_task_aspect_ratio(requested: Optional[str], master_aspect_ratio: str) -> str:
    """Return a valid task ratio, inheriting the project's master when absent.

    Provider-specific controls remain available for models that expose them;
    the structured master ratio is the default and invalid values fall back
    to it.  Keeping the fallback server-side protects API callers that bypass
    the frontend.
    """

    if requested in ASPECT_RATIOS:
        return requested
    return master_aspect_ratio if master_aspect_ratio in ASPECT_RATIOS else "16:9"


def export_resolutions_for_aspect_ratio(aspect_ratio: str) -> Tuple[str, ...]:
    """Return supported output resolutions in descending quality order."""

    return _EXPORT_RESOLUTIONS.get(aspect_ratio, _EXPORT_RESOLUTIONS["16:9"])


def resolution_matches_aspect_ratio(resolution: str, aspect_ratio: str) -> bool:
    """Compare a WxH resolution to a ratio after reducing both dimensions."""

    if aspect_ratio not in ASPECT_RATIOS or not isinstance(resolution, str):
        return False
    match = _RESOLUTION_RE.fullmatch(resolution)
    if not match:
        return False
    width, height = (int(part) for part in match.groups())
    ratio_width, ratio_height = (int(part) for part in aspect_ratio.split(":"))
    divisor = gcd(width, height)
    ratio_divisor = gcd(ratio_width, ratio_height)
    return (width // divisor, height // divisor) == (
        ratio_width // ratio_divisor,
        ratio_height // ratio_divisor,
    )


def effective_export_settings(
    export_settings: Optional[Dict[str, Any]], master_aspect_ratio: str
) -> Dict[str, Any]:
    """Keep export settings usable while forcing resolution to the master ratio."""

    settings = dict(export_settings or {})
    ratio = master_aspect_ratio if master_aspect_ratio in ASPECT_RATIOS else "16:9"
    resolution = settings.get("resolution")
    if resolution is None:
        return settings
    # Only normalize a well-formed resolution with the wrong orientation.
    # Malformed values must remain visible to the existing export validator so
    # callers still receive a useful validation error instead of a silent fix.
    if _RESOLUTION_RE.fullmatch(resolution or "") and resolution_matches_aspect_ratio(resolution, ratio):
        settings["resolution_source"] = settings.get("resolution_source", "explicit")
    elif _RESOLUTION_RE.fullmatch(resolution or "") and any(
        resolution in options
        for options in _EXPORT_RESOLUTIONS.values()
    ):
        # Known presets from an older project can be stale after the master
        # ratio changes.  Preserve arbitrary custom WxH values for backwards
        # compatibility; the export validator has always allowed them.
        settings["resolution"] = export_resolutions_for_aspect_ratio(ratio)[0]
        settings["resolution_source"] = "aspect_ratio_default"
    return settings
