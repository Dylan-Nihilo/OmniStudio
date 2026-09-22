"""Read-only production context shared by Source and Studio surfaces."""

from __future__ import annotations

from typing import Any


PRODUCTION_STAGES = ["script", "assets", "storyboard", "video", "audio", "assembly", "export"]


def _has_audio(frames: list[Any]) -> bool:
    dialogue_frames = [
        frame
        for frame in frames
        if getattr(frame, "dialogue", None)
        or getattr(frame, "dialogue_structured", None)
    ]
    # A narration-free episode does not need a TTS job.  Treating it as ready
    # keeps the canonical production guide from getting stuck at audio.
    return not dialogue_frames or all(bool(getattr(frame, "audio_url", None)) for frame in dialogue_frames)


def _has_video(frames: list[Any], video_tasks: list[Any]) -> bool:
    if not frames:
        return False
    completed_by_frame = {
        getattr(task, "frame_id", None)
        for task in video_tasks
        if getattr(task, "status", None) in {"completed", "succeeded"}
        and bool(getattr(task, "video_url", None))
    }
    return all(bool(getattr(frame, "video_url", None)) or getattr(frame, "id", None) in completed_by_frame for frame in frames)


def _production_stage(script: Any, *, has_assets: bool) -> str:
    frames = list(getattr(script, "frames", []) or [])
    if not bool(str(getattr(script, "original_text", "")).strip()):
        return "script"
    if not has_assets:
        return "assets"
    if not frames:
        return "storyboard"
    if not _has_video(frames, list(getattr(script, "video_tasks", []) or [])):
        return "video"
    if not _has_audio(frames):
        return "audio"
    if not getattr(script, "merged_video_url", None):
        return "assembly"
    return "export"


def build_source_production_context(
    *,
    repository: Any,
    pipeline: Any,
    workspace_id: str,
    episode_id: str,
) -> dict[str, Any]:
    """Build a stable, read-only view of an Episode's production readiness.

    The source relation is validated by ``list_script_source_dependencies``;
    this keeps the endpoint scoped to the authenticated workspace and avoids
    exposing a project that merely happens to have the same id.
    """

    script = pipeline.get_script(episode_id)
    if script is None:
        raise LookupError("Episode not found")
    dependencies = repository.list_script_source_dependencies(workspace_id, episode_id)
    stale_targets = repository.list_open_impact_targets_for_episode(workspace_id, episode_id)
    frames = list(getattr(script, "frames", []) or [])
    video_tasks = list(getattr(script, "video_tasks", []) or [])
    series = pipeline.get_series(getattr(script, "series_id", None)) if getattr(script, "series_id", None) else None
    resolved_assets = pipeline.resolve_episode_assets(script, series)
    characters = list(resolved_assets.get("characters", []))
    scenes = list(resolved_assets.get("scenes", []))
    props = list(resolved_assets.get("props", []))
    character_ids = {getattr(item, "id", None) for item in characters}
    scene_ids = {getattr(item, "id", None) for item in scenes}
    prop_ids = {getattr(item, "id", None) for item in props}
    has_video = _has_video(frames, video_tasks)
    has_audio = _has_audio(frames)
    merged = bool(getattr(script, "merged_video_url", None))
    has_assets = bool(character_ids or scene_ids or prop_ids)
    stage_statuses = {
        "script": "ready" if bool(str(getattr(script, "original_text", "")).strip()) else "pending",
        "assets": "ready" if has_assets else "pending",
        "storyboard": "ready" if frames else "pending",
        "video": "ready" if has_video else "pending",
        "audio": "ready" if has_audio else "pending",
        "assembly": "ready" if merged else "pending",
        "export": "ready" if merged else "pending",
    }
    return {
        "episode_id": episode_id,
        "project_id": getattr(script, "series_id", None) or episode_id,
        "title": str(getattr(script, "title", episode_id)),
        "episode_number": getattr(script, "episode_number", None),
        "source_dependencies": dependencies,
        "stale_targets": stale_targets,
        "production_stage": _production_stage(script, has_assets=has_assets),
        "stages": list(PRODUCTION_STAGES),
        "stage_statuses": stage_statuses,
        "aspect_ratio": str(
            pipeline.resolve_model_settings(episode_id).settings.storyboard_aspect_ratio
        ),
        "counts": {
            "characters": len(character_ids),
            "scenes": len(scene_ids),
            "props": len(prop_ids),
            "frames": len(frames),
            "video_tasks": len(video_tasks),
            "audio_frames": sum(1 for frame in frames if getattr(frame, "audio_url", None)),
        },
        "has_merged_video": merged,
    }
