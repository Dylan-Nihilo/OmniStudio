"""Resolve the intended shot soundtrack independently of container streams."""

from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class ShotAudioRenderSpec:
    mode: Optional[str]
    source: str
    dialogue_url: Optional[str] = None
    offset_ms: int = 0


def resolve_shot_audio_render_spec(frame: Any, task: Any) -> ShotAudioRenderSpec:
    mode = getattr(task.audio_mode, "value", task.audio_mode)
    if mode == "silent":
        return ShotAudioRenderSpec(mode, "silent")
    if frame.dubbed_video_url:
        if frame.dubbed_video_task_id != task.id:
            raise ValueError("配音属于其他视频，请为当前候选重新预览并应用配音")
        return ShotAudioRenderSpec(mode, "applied")
    if mode in {"native", "driven"}:
        return ShotAudioRenderSpec(mode, "source")
    if mode == "post":
        if frame.dialogue_lines or (frame.dialogue or "").strip():
            raise ValueError("后期配音尚未应用，请先生成、预览并应用配音")
        return ShotAudioRenderSpec(mode, "silent")
    # Historical takes did not record an audio mode or an application step.
    if frame.audio_url:
        return ShotAudioRenderSpec(mode, "dialogue", frame.audio_url, frame.dub_offset_ms)
    return ShotAudioRenderSpec(mode, "source")
