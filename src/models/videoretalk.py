"""Replace mouth motion with a recorded dialogue track through DashScope."""

import time
from typing import Callable

import requests

from .wanx import WanxModel
from ..utils.endpoints import get_provider_base_url


def replace_lip_sync(video_path: str, audio_path: str, output_path: str, *,
                     face_image_path: str | None = None,
                     task_id: str | None = None,
                     on_submitted: Callable[[str], None] | None = None) -> str:
    transport = WanxModel({})
    base = get_provider_base_url("DASHSCOPE")
    headers = {"Authorization": f"Bearer {transport.api_key}"}
    if not task_id:
        video_url = transport._create_dashscope_temp_url(video_path, "videoretalk")
        audio_url = transport._create_dashscope_temp_url(audio_path, "videoretalk")
        inputs = {"video_url": video_url, "audio_url": audio_url}
        if face_image_path:
            inputs["ref_image_url"] = transport._create_dashscope_temp_url(face_image_path, "videoretalk")
        response = requests.post(
            f"{base}/api/v1/services/aigc/image2video/video-synthesis",
            headers={**headers, "X-DashScope-Async": "enable", "X-DashScope-OssResourceResolve": "enable"},
            json={"model": "videoretalk", "input": inputs,
                  "parameters": {"video_extension": False}}, timeout=30,
        )
        if response.status_code != 200:
            raise RuntimeError(f"VideoRetalk submission failed (HTTP {response.status_code})")
        task_id = response.json().get("output", {}).get("task_id")
        if not task_id:
            raise RuntimeError("VideoRetalk did not return a task ID")
        if on_submitted:
            on_submitted(task_id)

    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        response = requests.get(f"{base}/api/v1/tasks/{task_id}", headers=headers, timeout=30)
        if response.status_code != 200:
            raise RuntimeError(f"VideoRetalk status check failed (HTTP {response.status_code})")
        output = response.json().get("output", {})
        status = output.get("task_status")
        if status == "SUCCEEDED":
            if not output.get("video_url"):
                raise RuntimeError("VideoRetalk completed without a video")
            transport._download_video(output["video_url"], output_path)
            return output_path
        if status in {"FAILED", "UNKNOWN", "CANCELED"}:
            raise RuntimeError(f"VideoRetalk failed: {output.get('code') or status}")
        time.sleep(5)
    raise RuntimeError("VideoRetalk is still running; refresh before requesting another generation")
