"""JojoKey video generation adapter.

JojoKey resells Seedance 2.0 / 2.5 and MiniMax H3 behind one Relay API Key, over two
separate lines:

``cn``
    ``POST /v1/video-cn/videos`` — settles in CNY and returns ``actual_cost_cny``. This is
    the line we want for Seedance: our whole credit system prices purchases in yuan with no
    exchange rate. It carries Seedance and accepts public reference URLs directly; local
    files are saved to the provider material library without paid pre-registration.
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

import hashlib
import logging
import mimetypes
import os
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import requests

from .base import VideoGenModel
from ..utils.endpoints import get_provider_base_url
from ..utils.model_catalog import get_catalog_accessor
from ..utils.media_refs import resolve_local_media_path
from ..utils.oss_utils import OSSImageUploader
from ..utils.provider_media import resolve_media_inputs
from ..utils.workspace_env import workspace_getenv

logger = logging.getLogger(__name__)

DEFAULT_LINE = "cn"
DEFAULT_MAX_WAIT_SECONDS = 1800
DEFAULT_POLL_INTERVAL_SECONDS = 8       # the API asks for one poll every 5-8 seconds

# Two request shapes share the /v1/videos endpoint. Seedance takes an OpenAI-style
# ``content[]`` with a role per reference; MiniMax A takes flat ``first_frame`` / ``images[]``
# fields plus an explicit ``mode``, and the contract says it rejects ``content`` outright.
# Which one a model wants comes from runtime.jojokey.dialect in the catalog.
DIALECT_SEEDANCE = "seedance"
DIALECT_MINIMAX_A = "minimax_a"

# Our generation mode -> MiniMax A's `mode`.
MINIMAX_A_MODES = {"t2v": "text", "i2v": "keyframe", "r2v": "reference", "v2v": "reference"}

# Asset kinds on the CN line's registration endpoint.
CN_ASSET_TYPES = {"image": 1, "video": 2, "audio": 3}

_TERMINAL_FAILURES = {"failed", "cancelled", "expired"}


class CnLineUnavailable(RuntimeError):
    """The CN line is switched off for this account, so the request never reached a model."""


class JojoKeyVideoModel(VideoGenModel):
    """Generate videos through the JojoKey relay."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._api_key = config.get("api_key")
        # Keep stable upload IDs; fetch fresh URLs when signed source links expire.
        self._upload_cache: Dict[Tuple[str, ...], str] = {}

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

    def _resolve_route(self, model_id: str, kwargs: Dict[str, Any]) -> Tuple[str, str, str]:
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
        dialect = (kwargs.get("dialect") or route.get("dialect") or DIALECT_SEEDANCE).strip().lower()
        if dialect not in (DIALECT_SEEDANCE, DIALECT_MINIMAX_A):
            raise ValueError(f"Unknown JojoKey dialect '{dialect}' for model {model_id}")
        return line, str(upstream), dialect

    # ---- HTTP plumbing -----------------------------------------------------------

    @staticmethod
    def _header_safe_key(value: str) -> str:
        """Reduce an idempotency key to something a header can carry.

        HTTP headers are latin-1, so a key with any non-ASCII in it raises before the request
        leaves. Job ids are ASCII today, but a key is caller-supplied and losing a generation
        to an encoding error is a bad trade. Non-ASCII runs collapse to a hash of the original
        so two different keys still cannot converge on one.
        """
        if value.isascii():
            return value[:128]
        digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:20]
        ascii_part = "".join(char for char in value if char.isascii() and char.isprintable())
        return f"{ascii_part[:80]}-{digest}".lstrip("-")

    def _headers(self, *, idempotency_key: Optional[str] = None) -> Dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = self._header_safe_key(str(idempotency_key))
        return headers

    def _base(self, line: str) -> str:
        base = get_provider_base_url("JOJOKEY")
        return f"{base}/video-cn/videos" if line == "cn" else f"{base}/videos"

    @staticmethod
    def _ensure_success(response: requests.Response, phase: str) -> None:
        if response.status_code >= 400:
            detail = " ".join((response.text or "").split())[:2000]
            suffix = f": {detail}" if detail else ""
            message = f"JojoKey {phase} failed with HTTP {response.status_code}{suffix}"
            if response.status_code == 403 and "VideoCnBetaNotEnabled" in detail:
                raise CnLineUnavailable(message)
            raise RuntimeError(message)
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

    def _resolved_urls(self, refs: List[str], *, model_id: str, modality: str,
                       line: str = "overseas", group_id: Optional[str] = None) -> List[str]:
        """Use provider uploads for local media when optional OSS is unavailable."""
        if not refs:
            return []
        uploader = OSSImageUploader()
        values = []
        for ref in refs:
            local_path = resolve_local_media_path(ref)
            if local_path and not getattr(uploader, "is_configured", False):
                values.append(self._upload_local_media(local_path, modality=modality,
                                                       line=line, group_id=group_id))
            else:
                values.extend(item.value for item in resolve_media_inputs(
                    [ref], model_name=model_id, modality=modality, backend="jojokey", uploader=uploader))
        return values

    def _upload_local_media(self, path: str, *, modality: str, line: str,
                            group_id: Optional[str]) -> str:
        content_type = mimetypes.guess_type(path)[0] or ""
        if not content_type.startswith(f"{modality}/"):
            raise ValueError(f"JojoKey {modality} upload has an unsupported file type")
        limit = {"image": 30, "video": 50, "audio": 15}[modality] * 1024 * 1024
        size = os.path.getsize(path)
        if size == 0 or size > limit:
            raise ValueError(f"JojoKey {modality} upload must be nonempty and at most {limit // 1024 // 1024} MB")
        base = get_provider_base_url("JOJOKEY")
        endpoint = "/video-cn/assets" if line == "cn" else "/uploads"
        with open(path, "rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
            scope = hashlib.sha256(self.api_key.encode()).hexdigest()
            # Include intent so save-only uploads cannot replay older paid registration requests.
            cache_key = ("upload-url", base, scope, line, modality, group_id or "", digest, content_type)
            asset_id = self._upload_cache.get(cache_key)
            if asset_id:
                response = requests.get(base + endpoint + "/" + quote(asset_id, safe=""),
                                        headers=self._headers(), timeout=30)
            else:
                key = "omni-upload:" + hashlib.sha256("\0".join(cache_key).encode()).hexdigest()
                filename = f"omni-{digest}{mimetypes.guess_extension(content_type) or ''}"
                data = {"register_asset": "false"}
                if line == "cn":
                    data = {"asset_type": str(CN_ASSET_TYPES[modality]),
                            "asset_name": filename, "register": "false"}
                    if group_id:
                        data["group_id"] = group_id
                headers = self._headers(idempotency_key=key)
                del headers["Content-Type"]  # requests supplies the multipart boundary.
                source.seek(0)
                response = requests.post(base + endpoint, headers=headers, data=data,
                                         files={"file": (filename, source, content_type)}, timeout=120)
        self._ensure_success(response, "media upload" if not asset_id else "media lookup")
        body = response.json()
        value = body.get("source_url") if line == "cn" else body.get("url")
        if not isinstance(value, str) or not value.startswith("https://"):
            raise RuntimeError("JojoKey uploaded material has no HTTPS URL")
        if isinstance(body.get("id"), str) and body["id"]:
            self._upload_cache[cache_key] = body["id"]
        return value

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

    def _build_minimax_a_payload(self, prompt: str, upstream_model: str, *,
                                 first_frame: Optional[str], reference_images: List[str],
                                 reference_videos: List[str], reference_audio: List[str],
                                 kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """MiniMax A's own shape: flat reference fields and an explicit mode.

        It shares the Seedance endpoint but not the schema — the contract states it rejects
        `content`, `extra_body` and the other Seedance-only fields, and it wants seconds/size
        rather than duration/resolution.
        """
        references = bool(reference_images or reference_videos or reference_audio)
        if references and first_frame and first_frame not in reference_images:
            reference_images = [first_frame, *reference_images]
        generation_mode = (kwargs.get("generation_mode") or "").strip().lower()
        if references:
            mode = "reference"
        elif first_frame:
            mode = "keyframe"
        else:
            mode = MINIMAX_A_MODES.get(generation_mode, "text")

        payload: Dict[str, Any] = {"model": upstream_model, "prompt": prompt, "mode": mode}
        if kwargs.get("resolution"):
            payload["size"] = kwargs["resolution"]
        duration = kwargs.get("duration")
        if duration is not None:
            payload["seconds"] = duration
        ratio = kwargs.get("ratio") or kwargs.get("aspect_ratio")
        if ratio:
            payload["aspect_ratio"] = ratio
        if kwargs.get("seed") is not None:
            payload["seed"] = kwargs["seed"]
        if mode == "keyframe":
            payload["first_frame"] = first_frame
            if kwargs.get("last_frame"):
                payload["last_frame"] = kwargs["last_frame"]
        elif mode == "reference":
            if reference_images:
                payload["images"] = reference_images
            if reference_videos:
                payload["videos"] = reference_videos
            if reference_audio:
                payload["audios"] = reference_audio
        return payload

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
        if ("2.5" in upstream_model and any(
                block.get("role") in {"reference_image", "reference_video", "reference_audio"}
                for block in content)):
            # Explicit reference generation permits the user's fixed duration and ratio.
            payload["omni_reference_task_type"] = "reference"
        if line == "overseas":
            # Preserve the overseas portrait-registration behavior. CN uses public URLs.
            payload["metadata"] = {"audit_image": True}
        return payload

    # ---- main entry point --------------------------------------------------------

    def generate(self, prompt: str, output_path: str, img_url: Optional[str] = None,
                 img_path: Optional[str] = None, **kwargs: Any) -> Tuple[str, float]:
        if not self.api_key.strip():
            raise ValueError("JOJOKEY_API_KEY is not configured")

        model_id = kwargs.get("model") or ""
        line, upstream_model, dialect = self._resolve_route(model_id, kwargs)
        start_time = time.time()

        try:
            video_url = self._submit_and_await(
                line, upstream_model, dialect, prompt, model_id, img_url, img_path, kwargs)
        except CnLineUnavailable:
            # The CN line is enabled per account by JojoKey's admin, and a disabled account
            # gets a 403 on every call. Falling back keeps generation working off whichever
            # line is actually open, and costs nothing extra: the price book is already
            # costed off the USD list, so the overseas price is the one we charge against.
            fallback = (kwargs.get("overseas_model")
                        or self._route_for(model_id).get("overseas_model"))
            if not fallback:
                raise
            logger.warning("[JojoKey] CN line unavailable for %s, retrying on the overseas "
                           "line as %s", model_id, fallback)
            video_url = self._submit_and_await(
                "overseas", str(fallback), dialect, prompt, model_id, img_url, img_path, kwargs)

        self._download(video_url, output_path)
        generation_time = time.time() - start_time
        logger.info("[JojoKey] Done in %.1fs -> %s", generation_time, output_path)
        return output_path, generation_time

    def _submit_and_await(self, line: str, upstream_model: str, dialect: str, prompt: str,
                          model_id: str, img_url: Optional[str], img_path: Optional[str],
                          kwargs: Dict[str, Any]) -> str:
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
            model_id=model_id, modality="image", line=line, group_id=kwargs.get("asset_group_id"))
        video_urls = self._resolved_urls(
            [url for url in (kwargs.get("ref_video_urls") or []) if url],
            model_id=model_id, modality="video", line=line, group_id=kwargs.get("asset_group_id"))
        audio_urls = self._resolved_urls(
            list(dict.fromkeys([url for url in [*(kwargs.get("ref_audio_urls") or []), kwargs.get("audio_url")] if url])),
            model_id=model_id, modality="audio", line=line, group_id=kwargs.get("asset_group_id"))

        resolved_first_frame = image_urls[0] if first_frame and image_urls else None
        resolved_references = image_urls if not first_frame else []
        if dialect == DIALECT_MINIMAX_A:
            if kwargs.get("last_frame"):
                if not resolved_first_frame or resolved_references or video_urls or audio_urls:
                    raise ValueError("MiniMax last frame requires keyframe mode without reference media")
                kwargs = {**kwargs, "last_frame": self._resolved_urls(
                    [kwargs["last_frame"]], model_id=model_id, modality="image", line=line)[0]}
            payload = self._build_minimax_a_payload(
                prompt, upstream_model, first_frame=resolved_first_frame,
                reference_images=resolved_references, reference_videos=video_urls,
                reference_audio=audio_urls, kwargs=kwargs)
        else:
            content = self._build_content(
                prompt,
                first_frame=resolved_first_frame,
                reference_images=resolved_references,
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
        logger.info("[JojoKey] Task %s submitted (line=%s, model=%s, dialect=%s)",
                    task_id, line, upstream_model, dialect)
        return self._await_video(submit_url, task_id)

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

    def account_status(self, timeout: float = 10.0) -> Dict[str, Any]:
        """Report whether either line can actually accept a job.

        The generic provider probe asks for ``/v1/models``, which answers 200 for an account
        with no balance and a disabled CN line — a green light for something that cannot
        generate. This reads the two account endpoints instead and says what is blocking.
        """
        base = get_provider_base_url("JOJOKEY")
        status: Dict[str, Any] = {"cn_enabled": False, "cn_balance_cny": 0.0,
                                  "usd_spendable": 0.0, "ready": False, "blockers": []}
        reasons: List[str] = []
        try:
            cn = requests.get(f"{base}/video-cn/me", headers=self._headers(), timeout=timeout)
            self._ensure_success(cn, "CN account read")
            body = cn.json()
            status["cn_enabled"] = bool(body.get("enabled"))
            status["cn_balance_cny"] = float(body.get("balance_cny") or 0)
        except Exception as error:
            reasons.append(f"国内线状态读取失败：{error}")

        try:
            me = requests.get(f"{base}/me", headers=self._headers(), timeout=timeout)
            self._ensure_success(me, "account read")
            body = me.json()
            status["usd_spendable"] = float(body.get("spendable_usd") or 0)
        except Exception as error:
            reasons.append(f"海外线状态读取失败：{error}")

        cn_ready = status["cn_enabled"] and status["cn_balance_cny"] > 0
        overseas_ready = status["usd_spendable"] > 0
        if not status["cn_enabled"]:
            reasons.append("国内线（JojoKey Video CN Beta）未对该账号开放，需要 JojoKey 后台开启")
        elif status["cn_balance_cny"] <= 0:
            reasons.append("国内线余额为 0")
        if not overseas_ready:
            reasons.append("海外线可用余额为 0")
        status["ready"] = cn_ready or overseas_ready
        # Either line being usable is enough to generate, so a working account reports no
        # blockers rather than complaining about the line it is not using.
        status["blockers"] = [] if status["ready"] else reasons
        return status

    @staticmethod
    def _env_number(name: str, default: int) -> int:
        try:
            value = int(workspace_getenv(name, str(default)) or default)
        except (TypeError, ValueError):
            return default
        return max(1, value)
