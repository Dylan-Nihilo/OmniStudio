"""Deterministic storyboard readiness and continuity checks."""

from __future__ import annotations

from typing import Any


def _frame_value(frame: Any, key: str) -> Any:
    value = getattr(frame, key, None)
    if value is not None:
        return value
    composition = getattr(frame, "composition_data", None)
    if isinstance(composition, dict):
        return composition.get(key)
    return None


def evaluate_continuity_ledger(script: Any) -> dict[str, Any]:
    """Return deterministic, shot-localized continuity issues for adjacent frames."""
    frames = list(getattr(script, "frames", []) or [])
    issues: list[dict[str, Any]] = []
    explicit_transitions = {"cut", "dissolve", "fade", "fade_in", "fade_out", "whip_pan"}
    for previous, current in zip(frames, frames[1:]):
        transition = getattr(previous, "transition_hint", None)
        if getattr(previous, "scene_id", None) != getattr(current, "scene_id", None) and transition not in explicit_transitions and transition != "match_cut":
            issues.append({
                "code": "ADJACENT_SCENE_MISMATCH",
                "shot_id": current.id,
                "previous_shot_id": previous.id,
                "field": "scene_id",
                "message": "相邻镜头场景发生变化，但上一镜未声明转场",
                "blocking": True,
            })
        previous_direction = _frame_value(previous, "screen_direction")
        current_direction = _frame_value(current, "screen_direction")
        if previous_direction and current_direction and previous_direction != current_direction and transition not in explicit_transitions:
            issues.append({
                "code": "SCREEN_DIRECTION_MISMATCH",
                "shot_id": current.id,
                "previous_shot_id": previous.id,
                "field": "screen_direction",
                "message": "相邻镜头屏幕方向不一致",
                "blocking": True,
            })
    return {"issues": issues, "checked_shots": len(frames)}


def evaluate_storyboard_readiness(script: Any) -> dict[str, Any]:
    scenes = {item.id for item in getattr(script, "scenes", [])}
    characters = {item.id for item in getattr(script, "characters", [])}
    props = {item.id for item in getattr(script, "props", [])}
    frames = list(getattr(script, "frames", []) or [])
    blockers: list[dict[str, Any]] = []

    if not frames:
        blockers.append({"code": "NO_FRAMES", "message": "至少需要一个分镜镜头"})
    for index, frame in enumerate(frames):
        if not getattr(frame, "scene_id", None) or frame.scene_id not in scenes:
            blockers.append({"code": "SCENE_NOT_FOUND", "frame_id": frame.id, "message": "镜头引用的场景不存在"})
        if not (getattr(frame, "visual_description", None) or getattr(frame, "action_description", None)):
            blockers.append({"code": "FRAME_DESCRIPTION_REQUIRED", "frame_id": frame.id, "message": "镜头缺少画面描述"})
        for character_id in getattr(frame, "character_ids", []) or []:
            if character_id not in characters:
                blockers.append({"code": "CHARACTER_NOT_FOUND", "frame_id": frame.id, "reference_id": character_id, "message": "镜头引用的角色不存在"})
        for prop_id in getattr(frame, "prop_ids", []) or []:
            if prop_id not in props:
                blockers.append({"code": "PROP_NOT_FOUND", "frame_id": frame.id, "reference_id": prop_id, "message": "镜头引用的道具不存在"})
        if index and getattr(frames[index - 1], "transition_hint", None) == "match_cut":
            previous = frames[index - 1]
            if getattr(previous, "scene_id", None) != getattr(frame, "scene_id", None):
                blockers.append({"code": "MATCH_CUT_SCENE_CONFLICT", "frame_id": frame.id, "previous_frame_id": previous.id, "message": "Match cut 的相邻镜头必须保持同一场景"})

    continuity_ledger = evaluate_continuity_ledger(script)
    continuity_issues = continuity_ledger["issues"]
    blockers.extend(continuity_issues)
    return {
        "ready": not blockers,
        "blockers": blockers,
        "continuity_issues": continuity_issues,
        "continuity_ledger": continuity_ledger,
        "checked_frames": len(frames),
    }


__all__ = ["evaluate_continuity_ledger", "evaluate_storyboard_readiness"]
