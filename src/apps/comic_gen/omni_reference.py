"""Saved per-shot inputs for Seedance multimodal reference generation."""
import ipaddress
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import Literal


def supports_omni_reference(model: str) -> bool:
    return model in {"seedance-2.5-r2v", "seedance/seedance-2.5-video#r2v"}


def validate_omni_counts(model: str, images: list[str], videos: list[str], audios: list[str]) -> None:
    if not supports_omni_reference(model):
        return
    from ...utils.model_catalog import load_generated_model_catalog
    inputs = load_generated_model_catalog()["models"]["seedance-2.5-r2v"]["inputs"]
    for field, refs, label in (("reference_images", images, "图片"), ("reference_videos", videos, "视频"), ("reference_audio", audios, "音频")):
        limit = inputs[field]["max"]
        if len(refs) > limit:
            raise ValueError(f"当前模型最多使用 {limit} 个{label}参考")


def public_https(value: str) -> bool:
    parsed = urlsplit(value)
    host = parsed.hostname or ""
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        return False
    if host == "localhost" or host.endswith((".localhost", ".local")):
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return True


class OmniMediaReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=4096)
    purpose: str = Field(default="", max_length=500)

    @field_validator("url")
    @classmethod
    def supported_source(cls, value: str) -> str:
        value = value.strip()
        if public_https(value):
            return value
        if value.startswith(("uploads/", "video/")) and value.lower().endswith((".mp4", ".mov")) and not any(part in ("", ".", "..") for part in value.split("/")) and "\\" not in value and "?" not in value and "#" not in value:
            return value
        raise ValueError("请使用已上传的视频或可公开访问的 HTTPS 地址")


class OmniReferenceSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    videos: list[OmniMediaReference] = Field(default_factory=list, max_length=10)
    audios: list[OmniMediaReference] = Field(default_factory=list, max_length=10)
    audio_mode: Literal["native", "driven", "post", "silent"] = "post"

    @model_validator(mode="after")
    def audio_sources(self):
        if any(not public_https(item.url) for item in self.audios):
            raise ValueError("当前声音参考需要可公开访问的 HTTPS 音频地址")
        for items in (self.videos, self.audios):
            if len({item.url for item in items}) != len(items):
                raise ValueError("同一种参考素材不能重复添加")
        return self

    def video_prompt(self, prompt: str) -> str:
        parts = [prompt]
        for index, item in enumerate(self.videos, 1):
            parts.append(f"参考视频 {index}：{item.purpose or '参考动作、表演和运镜节奏，人物与场景外观沿用图片参考。'}")
        if self.audio_mode == "driven":
            for index, item in enumerate(self.audios, 1):
                parts.append(f"参考音频 {index}：{item.purpose or '参考音色、语气和说话节奏，台词仍以本片段剧本为准。'}")
        if self.audio_mode == "native":
            parts.append("生成本片段对白及与画面同步的环境声，按角色分配台词，不新增台词。")
        return "\n".join(parts)
