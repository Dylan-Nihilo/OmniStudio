"""JojoKey video generation adapter.

JojoKey resells Seedance 2.0 / 2.5 and MiniMax H3 behind one Relay API Key, over two
separate lines:

``cn``
    ``POST /v1/video-cn/videos`` — settles in CNY and returns ``actual_cost_cny``. This is
    the line we want for Seedance: our whole credit system prices purchases in yuan with no
    exchange rate. It only carries Seedance, and every reference asset has to be registered
    into an ``asset://`` handle before it can be used.
``overseas``
    ``POST /v1/videos`` — settles in USD, but it is the only line that carries MiniMax H3.
    It accepts public HTTPS URLs inline, so no asset registration step.

Both lines submit-then-poll and hand back a ``video_url`` that **expires 23 hours later**,
so the file is downloaded as soon as the task succeeds rather than stored as a link.

Which line and which upstream model a request uses comes from the model catalog
(``runtime.jojokey`` on the canonical mode), not from code: switching a tier to a cheaper
upstream model or moving Seedance between lines is a YAML edit.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

from .base import VideoGenModel
from ..utils.endpoints import get_provider_base_url
from ..utils.model_catalog import get_catalog_accessor
from ..utils.oss_utils import OSSImageUploader
from ..utils.provider_media import resolve_media_inputs
from ..utils.workspace_env import workspace_getenv

logger = logging.getLogger(__name__)

DEFAULT_LINE = "cn"
DEFAULT_MAX_WAIT_SECONDS = 1800
DEFAULT_POLL_INTERVAL_SECONDS = 8       # the API asks for one poll every 5-8 seconds

# Asset kinds on the CN line's registration endpoint.
CN_ASSET_TYPES = {"image": 1, "video": 2, "audio": 3}

_TERMINAL_FAILURES = {"failed", "cancelled", "expired"}


class JojoKeyVideoModel(VideoGenModel):
    """Generate videos through the JojoKey relay."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._api_key = config.get("api_key")

    # ---- credentials and routing -------------------------------------------------

    @property
    def api_key(self) -> str:
        return self._api_key or workspace_getenv("JOJOKEY_API_KEY", "") or ""

    @staticmethod
    def _route_for(model_id: str) -> Dict[str, Any]:
        """Read line + upstream model for one of our model ids off the catalog.

        Returns an empty dict when the catalog has nothing to say, which lets the caller
        fall back to explicit kwargs instead of failing on a catalog lookup.
        """
        if not model_id:
            return {}
        try:
            accessor = get_catalog_accessor()
            canonical = accessor.resolve_legacy_to_canonical(model_id) or model_id
            runtime = accessor.get_mode_runtime(canonical) or {}
        except Exception as error:                      # catalog problems must not block a call
            logger.warning("[JojoKey] Could not read catalog routing for %s: %s", model_id, error)
            return {}
        return dict(runtime.get("jojokey") or {})

    def _resolve_route(self, model_id: str, kwargs: Dict[str, Any]) -> Tuple[str, str]:
        route = self._route_for(model_id)
        line = (kwargs.get("line") or route.get("line") or DEFAULT_LINE).strip().lower()
        if line not in ("cn", "overseas"):
            raise ValueError(f"Unknown JojoKey line '{line}' for model {model_id}")
        # A tier can name a different upstream model per line, because the CN and overseas
        # catalogues do not use the same ids for the same product.
        key = "upstream_model" if line == "cn" else "overseas_model"
        upstream = kwargs.get("upstream_model") or route.get(key) or route.get("upstream_model")
        if not upstream:
            raise ValueError(
                f"No JojoKey upstream model configured for {model_id} on the {line} line; "
                "set runtime.jojokey in the model catalog."
            )
        return line, str(upstream)

    # ---- HTTP plumbing -----------------------------------------------------------

    def _headers(self, *, idempotency_key: Optional[str] = None) -> Dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def _base(self, line: str) -> str:
        base = get_provider_base_url("JOJOKEY")
        return f"{base}/video-cn/videos" if line == "cn" else f"{base}/videos"

    @staticmethod
    def _ensure_success(response: requests.Response, phase: str) -> None:
        if response.status_code >= 400:
            detail = " ".join((response.text or "").split())[:2000]
            suffix = f": {detail}" if detail else ""
            raise RuntimeError(f"JojoKey {phase} failed with HTTP {response.status_code}{suffix}")
        response.raise_for_status()

    @staticmethod
    def _describe_failure(task: Dict[str, Any]) -> str:
        """Build a message worth showing a user.

        The API returns a sanitised upstream original in ``source_message`` plus its own
        Chinese explanation and a suggested fix; the docs are explicit that a client should
        not show only the generic ``message``.
        """
        error = task.get("error") or {}
        if not isinstance(error, dict):
            return str(task)
        parts = [str(error.get(key)) for key in ("code", "source_message", "message", "suggestion")]
        return " | ".join(part for part in parts if part and part != "None") or str(task)

    # ---- reference assets --------------------------------------------------------

    def _resolved_urls(self, refs: List[str], *, model_id: str, modality: str) -> List[str]:
        """Turn project-side refs into public URLs JojoKey can fetch."""
        if not refs:
            return []
        resolved = resolve_media_inputs(
            refs,
            model_name=model_id,
            modality=modality,
            backend="jojokey",
            uploader=OSSImageUploader(),
        )
        return [item.value for item in resolved]

    def _register_cn_asset(self, url: str, *, modality: str, group_id: Optional[str]) -> str:
        """Register a public URL as a CN-line ``asset://`` handle.

        The CN line takes ``asset://`` references in ``content[]`` rather than raw URLs, so
        every image and video has to go through here first.
        """
        base = get_provider_base_url("JOJOKEY")
        payload: Dict[str, Any] = {
            "url": url,
            "asset_type": CN_ASSET_TYPES[modality],
            "asset_name": os.path.basename(url.split("?")[0]) or f"omni-{modality}",
        }
        if group_id:
            payload["group_id"] = group_id
        response = requests.post(
            f"{base}/video-cn/assets/from-url",
            headers=self._headers(),
            json=payload,
            timeout=60,
        )
        self._ensure_success(response, "asset registration")
        body = response.json()
        asset_url = body.get("asset_url") or body.get("url")
        if not asset_url:
            raise RuntimeError(f"JojoKey asset registration returned no asset_url: {body}")
        return str(asset_url)

    # ---- payload -----------------------------------------------------------------

    def _build_content(self, prompt: str, *, first_frame: Optional[str],
                       reference_images: List[str], reference_videos: List[str],
                       reference_audio: List[str]) -> List[Dict[str, Any]]:
        """Assemble ``content[]``.

        The upstream refuses ``first_frame`` and ``reference_image`` in the same task, so a
        caller that supplies both is treated as multi-reference: that is the mode the extra
        images were asked for, and silently dropping them would be worse. Each image needs
        its own block with its own single URL — several URLs in one field is rejected.
        """
        content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
        if reference_images:
            for url in reference_images:
                content.append({"type": "image_url", "image_url": {"url": url},
                                "role": "reference_image"})
        elif first_frame:
            content.append({"type": "image_url", "image_url": {"url": first_frame},
                            "role": "first_frame"})
        for url in reference_videos:
            content.append({"type": "video_url", "video_url": {"url": url},
                            "role": "reference_video"})
        for url in reference_audio:
            content.append({"type": "audio_url", "audio_url": {"url": url},
                            "role": "reference_audio"})
        return content

    def _build_payload(self, prompt: str, upstream_model: str, line: str,
                       content: List[Dict[str, Any]], kwargs: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"model": upstream_model, "content": content}
        resolution = kwargs.get("resolution")
        if resolution:
            payload["resolution"] = resolution
        duration = kwargs.get("duration")
        if duration is not None:
            payload["duration"] = duration
        ratio = kwargs.get("ratio") or kwargs.get("aspect_ratio")
        if ratio:
            payload["ratio"] = ratio
        seed = kwargs.get("seed")
        if seed is not None:
            payload["seed"] = seed
        if kwargs.get("generate_audio") is not None:
            payload["generate_audio"] = bool(kwargs["generate_audio"])
        if line == "overseas":
            # Pre-registering reference images as assets first makes the upstream far less
            # likely to reject a bare face URL on privacy grounds. The CN line registers
            # everything up front anyway, so this only applies here.
            payload["metadata"] = {"audit_image": True}
        return payload

    # ---- main entry point --------------------------------------------------------

    def generate(self, prompt: str, output_path: str, img_url: Optional[str] = None,
                 img_path: Optional[str] = None, **kwargs: Any) -> Tuple[str, float]:
        if not self.api_key.strip():
            raise ValueError("JOJOKEY_API_KEY is not configured")

        model_id = kwargs.get("model") or ""
        line, upstream_model = self._resolve_route(model_id, kwargs)
        start_time = time.time()

        generation_mode = (kwargs.get("generation_mode") or "").strip().lower()
        primary = img_url or img_path
        extras = [url for url in (kwargs.get("ref_image_urls") or []) if url]
        # i2v drives the video from one still, so the storyboard frame goes as the first
        # frame; r2v guides it with a set of references instead. Anything carrying several
        # images is multi-reference whatever the caller called it — and the primary image
        # has to stay in that set. Upstream refuses first_frame alongside reference_image,
        # so the only alternative would be dropping an image the caller asked for.
        if generation_mode == "r2v" or extras:
            first_frame = None
            ref_images = ([primary] if primary and primary not in extras else []) + extras
        else:
            first_frame = primary
            ref_images = []

        image_urls = self._resolved_urls(
            ([first_frame] if first_frame else []) + ref_images,
            model_id=model_id, modality="image")
        video_urls = self._resolved_urls(
            [url for url in (kwargs.get("ref_video_urls") or []) if url],
            model_id=model_id, modality="video")
        audio_urls = self._resolved_urls(
            [url for url in ([kwargs.get("audio_url")] if kwargs.get("audio_url") else []) if url],
            model_id=model_id, modality="audio")

        if line == "cn":
            group_id = kwargs.get("asset_group_id")
            image_urls = [self._register_cn_asset(url, modality="image", group_id=group_id)
                          for url in image_urls]
            video_urls = [self._register_cn_asset(url, modality="video", group_id=group_id)
                          for url in video_urls]
            audio_urls = [self._register_cn_asset(url, modality="audio", group_id=group_id)
                          for url in audio_urls]

        content = self._build_content(
            prompt,
            first_frame=image_urls[0] if first_frame and image_urls else None,
            reference_images=image_urls if not first_frame else [],
            reference_videos=video_urls,
            reference_audio=audio_urls,
        )
        payload = self._build_payload(prompt, upstream_model, line, content, kwargs)

        submit_url = self._base(line)
        response = requests.post(
            submit_url,
            headers=self._headers(idempotency_key=kwargs.get("idempotency_key")),
            json=payload,
            timeout=60,
        )
        self._ensure_success(response, "submit")
        task = response.json()
        task_id = task.get("id")
        if not task_id:
            raise RuntimeError(f"JojoKey submit returned no task id: {task}")
        logger.info("[JojoKey] Task %s submitted (line=%s, model=%s)", task_id, line, upstream_model)

        video_url = self._await_video(submit_url, task_id)
        self._download(video_url, output_path)
        generation_time = time.time() - start_time
        logger.info("[JojoKey] Done in %.1fs -> %s", generation_time, output_path)
        return output_path, generation_time

    def _await_video(self, submit_url: str, task_id: str) -> str:
        max_wait = self._env_number("JOJOKEY_MAX_WAIT_SECONDS", DEFAULT_MAX_WAIT_SECONDS)
        poll_interval = self._env_number("JOJOKEY_POLL_INTERVAL_SECONDS", DEFAULT_POLL_INTERVAL_SECONDS)
        poll_url = f"{submit_url}/{task_id}"
        elapsed = 0

        while True:
            response = requests.get(poll_url, headers=self._headers(), timeout=30)
            self._ensure_success(response, "poll")
            task = response.json()
            status = str(task.get("status") or "").strip().lower()
            logger.info("[JojoKey] Task %s status: %s (%ss)", task_id, status or "unknown", elapsed)

            if status == "succeeded":
                video_url = task.get("video_url") or (task.get("output") or {}).get("video_url")
                if not video_url:
                    raise RuntimeError(f"JojoKey task succeeded without a video URL: {task}")
                return str(video_url)
            if status in _TERMINAL_FAILURES:
                raise RuntimeError(f"JojoKey task {status}: {self._describe_failure(task)}")

            if elapsed >= max_wait:
                break
            time.sleep(poll_interval)
            elapsed += poll_interval

        raise RuntimeError(f"JojoKey task timed out after {max_wait}s")

    def _download(self, video_url: str, output_path: str) -> None:
        """Fetch the result immediately — the URL stops working 23 hours after success."""
        response = requests.get(video_url, timeout=300)
        self._ensure_success(response, "download")
        output_dir = os.path.dirname(output_path)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        with open(output_path, "wb") as output_file:
            output_file.write(response.content)

    @staticmethod
    def _env_number(name: str, default: int) -> int:
        try:
            value = int(workspace_getenv(name, str(default)) or default)
        except (TypeError, ValueError):
            return default
        return max(1, value)
