"""MOMA video generation adapter.

The MOMA gateway exposes an asynchronous, OpenAI-style content payload:
``POST /v1/videos`` returns a task id and ``GET /v1/videos/{task_id}`` returns
the generated media URL.  Authentication is workspace-scoped via
``MOMA_API_KEY``.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Tuple

import requests

from .base import VideoGenModel
from ..utils.endpoints import get_provider_base_url
from ..utils.oss_utils import OSSImageUploader
from ..utils.provider_media import resolve_media_inputs
from ..utils.workspace_env import workspace_getenv

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "minimax/minimax-h3"
DEFAULT_MAX_WAIT_SECONDS = 600
DEFAULT_POLL_INTERVAL_SECONDS = 20


class MomaVideoModel(VideoGenModel):
    """Generate videos through the China Mobile MOMA gateway."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._api_key = config.get("api_key")
        self.model_name = config.get("params", {}).get("model_name", DEFAULT_MODEL)

    @property
    def api_key(self) -> str:
        return self._api_key or workspace_getenv("MOMA_API_KEY", "") or ""

    def _submit_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _poll_headers(self, model_name: str) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "X-Model-Name": model_name,
        }

    @staticmethod
    def _ensure_success(response: requests.Response, phase: str) -> None:
        if response.status_code >= 400:
            detail = " ".join((response.text or "").split())[:2000]
            suffix = f": {detail}" if detail else ""
            raise RuntimeError(
                f"MOMA {phase} failed with HTTP {response.status_code}{suffix}"
            )
        response.raise_for_status()

    @staticmethod
    def _optional_content_item(kind: str, value: str | None) -> Dict[str, str] | None:
        if not value:
            return None
        return {"type": kind, kind: value}

    @staticmethod
    def _content_values(kind: str, kwargs: Dict[str, Any]) -> List[str]:
        values: List[str] = []
        singular = kwargs.get(kind)
        if isinstance(singular, str) and singular:
            values.append(singular)

        plural = kwargs.get(f"{kind}s")
        if isinstance(plural, str):
            plural = [plural]
        if isinstance(plural, (list, tuple)):
            values.extend(value for value in plural if isinstance(value, str) and value)
        return values

    def _build_payload(self, prompt: str, model_name: str, **kwargs: Any) -> Dict[str, Any]:
        content: list[Dict[str, str]] = [{"type": "text", "text": prompt}]
        for kind in ("image_url", "video_url", "audio_url"):
            for value in self._content_values(kind, kwargs):
                item = self._optional_content_item(kind, value)
                if item:
                    content.append(item)

        payload: Dict[str, Any] = {"model": model_name, "content": content}
        for key in ("resolution", "duration", "ratio"):
            value = kwargs.get(key)
            if value is not None:
                payload[key] = value
        return payload

    def _resolve_media_kwargs(self, model_name: str, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        resolved_kwargs = dict(kwargs)
        uploader = OSSImageUploader()
        modality_by_kind = {
            "image_url": "image",
            "video_url": "video",
            "audio_url": "audio",
        }
        for kind, modality in modality_by_kind.items():
            refs = self._content_values(kind, kwargs)
            if not refs:
                continue
            resolved = resolve_media_inputs(
                refs,
                model_name=model_name,
                modality=modality,
                backend="moma",
                uploader=uploader,
            )
            resolved_kwargs.pop(kind, None)
            resolved_kwargs[f"{kind}s"] = [item.value for item in resolved]
        return resolved_kwargs

    @staticmethod
    def _env_number(name: str, default: int) -> int:
        try:
            value = int(workspace_getenv(name, str(default)) or default)
        except (TypeError, ValueError):
            return default
        return max(0, value)

    def generate(self, prompt: str, output_path: str, **kwargs: Any) -> Tuple[str, float]:
        api_key = self.api_key.strip()
        if not api_key:
            raise ValueError("MOMA_API_KEY is not configured")

        model_name = kwargs.get("model") or self.model_name
        base_url = get_provider_base_url("MOMA")
        submit_url = f"{base_url}/videos"
        resolved_kwargs = self._resolve_media_kwargs(model_name, kwargs)
        payload = self._build_payload(prompt, model_name, **resolved_kwargs)
        start_time = time.time()

        response = requests.post(
            submit_url,
            headers=self._submit_headers(),
            json=payload,
            timeout=30,
        )
        self._ensure_success(response, "submit")
        result = response.json()
        task_id = result.get("task_id")
        if not task_id:
            raise RuntimeError(f"MOMA API response did not include task_id: {result}")
        logger.info("[MOMA] Task submitted: %s (model=%s)", task_id, model_name)

        max_wait = self._env_number("MOMA_MAX_WAIT_SECONDS", DEFAULT_MAX_WAIT_SECONDS)
        poll_interval = self._env_number(
            "MOMA_POLL_INTERVAL_SECONDS", DEFAULT_POLL_INTERVAL_SECONDS
        )
        poll_url = f"{submit_url}/{task_id}"
        elapsed = 0

        while elapsed <= max_wait:
            task_response = requests.get(
                poll_url,
                headers=self._poll_headers(model_name),
                timeout=30,
            )
            self._ensure_success(task_response, "poll")
            task_result = task_response.json()
            task = task_result.get("task") or {}
            status = str(task.get("status") or "").upper()
            logger.info("[MOMA] Task %s status: %s (%ss)", task_id, status or "UNKNOWN", elapsed)

            if status == "SUCCEEDED":
                content = task.get("content") or {}
                video_url = content.get("url") if isinstance(content, dict) else None
                if not video_url:
                    raise RuntimeError(f"MOMA task succeeded without a video URL: {task_result}")
                video_response = requests.get(video_url, timeout=120)
                self._ensure_success(video_response, "download")
                output_dir = os.path.dirname(output_path)
                if output_dir:
                    os.makedirs(output_dir, exist_ok=True)
                with open(output_path, "wb") as output_file:
                    output_file.write(video_response.content)
                generation_time = time.time() - start_time
                logger.info("[MOMA] Done in %.1fs -> %s", generation_time, output_path)
                return output_path, generation_time

            if status == "FAILED":
                raise RuntimeError(f"MOMA task failed: {task_result}")

            if elapsed >= max_wait:
                break
            time.sleep(poll_interval)
            elapsed += poll_interval

        raise RuntimeError(f"MOMA task timed out after {max_wait}s")
