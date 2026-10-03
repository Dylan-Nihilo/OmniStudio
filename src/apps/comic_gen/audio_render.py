"""Resolve the intended shot soundtrack independently of container streams."""

from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class ShotAudioRenderSpec:
    mode: Optional[str]
    source: str
    dialogue_url: Optional[str] = None
    offset_ms: int = 0


def resolve_shot_audio_render_spec(frame: Any, task: Any, policy: Any = None) -> ShotAudioRenderSpec:
    recorded = getattr(task, "audio_mode", None)
    recorded = getattr(recorded, "value", recorded)
    override = getattr(frame, "audio_policy_override", None)
    intent = override or (policy if recorded is not None else None)
    mode = getattr(intent.mode, "value", intent.mode) if intent else recorded
    if mode == "silent":
        return ShotAudioRenderSpec(mode, "silent")
    snapshot = getattr(frame, "dubbed_audio_policy", None)
    if getattr(frame, "dubbed_video_url", None) and (mode not in {"native", "driven"} or (mode == "native" and snapshot and snapshot.mode == "native")):
        if getattr(frame, "dubbed_video_task_id", None) != task.id:
            raise ValueError("配音属于其他视频，请为当前候选重新预览并应用配音")
        if snapshot and (snapshot != intent or getattr(frame, "dubbed_audio_url", None) != frame.audio_url):
            raise ValueError("配音或声音策略已改变，请重新预览并应用配音")
        return ShotAudioRenderSpec(mode, "applied")
    if mode in {"native", "driven"}:
        if recorded != mode:
            raise ValueError("当前候选未按所选声音方式生成，请重新生成视频")
        return ShotAudioRenderSpec(mode, "source")
    if mode == "post":
        if getattr(frame, "dialogue_lines", None) or (getattr(frame, "dialogue", None) or "").strip():
            raise ValueError("后期配音尚未应用，请先生成、预览并应用配音")
        return ShotAudioRenderSpec(mode, "silent")
    # Historical takes did not record an audio mode or an application step.
    if getattr(frame, "audio_url", None):
        return ShotAudioRenderSpec(mode, "dialogue", frame.audio_url, getattr(frame, "dub_offset_ms", 0))
    return ShotAudioRenderSpec(mode, "source")
