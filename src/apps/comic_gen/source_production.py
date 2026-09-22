"""Read-only production context shared by Source and Studio surfaces."""

from __future__ import annotations

from typing import Any


PRODUCTION_STAGES = ["script", "assets", "storyboard", "video", "audio", "assembly", "export"]


def _has_audio(frames: list[Any]) -> bool:
    dialogue_frames = [frame for frame in frames if getattr(frame, "dialogue", None)]
    return bool(dialogue_frames) and all(bool(getattr(frame, "audio_url", None)) for frame in dialogue_frames)


def _has_video(frames: list[Any], video_tasks: list[Any]) -> bool:
    return any(bool(getattr(frame, "video_url", None)) for frame in frames) or any(
        getattr(task, "status", None) in {"completed", "succeeded"} and bool(getattr(task, "video_url", None))
        for task in video_tasks
    )


def _production_stage(script: Any) -> str:
    frames = list(getattr(script, "frames", []) or [])
    if not frames:
        return "script"
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
    characters = list(getattr(script, "characters", []) or [])
    scenes = list(getattr(script, "scenes", []) or [])
    props = list(getattr(script, "props", []) or [])
    has_video = _has_video(frames, video_tasks)
    has_audio = _has_audio(frames)
    merged = bool(getattr(script, "merged_video_url", None))
    has_assets = bool(characters or scenes or props)
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
        "project_id": episode_id,
        "title": str(getattr(script, "title", episode_id)),
        "episode_number": getattr(script, "episode_number", None),
        "source_dependencies": dependencies,
        "stale_targets": stale_targets,
        "production_stage": _production_stage(script),
        "stages": list(PRODUCTION_STAGES),
        "stage_statuses": stage_statuses,
        "aspect_ratio": str(getattr(script, "production_aspect_ratio", None) or "9:16"),
        "counts": {
            "characters": len(characters),
            "scenes": len(scenes),
            "props": len(props),
            "frames": len(frames),
            "video_tasks": len(video_tasks),
            "audio_frames": sum(1 for frame in frames if getattr(frame, "audio_url", None)),
        },
        "has_merged_video": merged,
    }
