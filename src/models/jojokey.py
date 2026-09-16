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

import hashlib
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

from .base import VideoGenModel
from ..utils.endpoints import get_provider_base_url
from ..utils.model_catalog import get_catalog_accessor
from ..utils.oss_utils import OSSImageUploader
from ..utils.media_refs import resolve_local_media_path
from ..utils.provider_media import resolve_media_inputs
from ..utils.workspace_env import workspace_getenv

logger = logging.getLogger(__name__)

DEFAULT_LINE = "cn"
DEFAULT_MAX_WAIT_SECONDS = 1800
DEFAULT_POLL_INTERVAL_SECONDS = 8       # the API asks for one poll every 5-8 seconds
DEFAULT_ASSET_SYNC_SECONDS = 120        # how long to wait for a reference asset to sync
ASSET_POLL_INTERVAL_SECONDS = 3

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

# The upstream silently refuses images outside these bounds. Neither the bounds nor the
# refusal are documented: a registration comes back HTTP 200 with an empty asset_url, holds
# ¥0.10, parks at registration_state "pending" for ever, and reports nothing more useful
# than operation.error_code "submission_unknown". Measured against the live CN line on
# 2026-09-16, one ¥0.10 registration per data point:
#
#     300x300  ok        200x200  refused        (short side)
#     1024x410 ok (2.5)  1024x341 refused (3.0)  (aspect)
#
# which lands exactly on the limits Volcengine publishes for Seedance — short side at least
# 300px, aspect no wider than 5:2. Checking here costs nothing and turns an unexplained
# failure into a message naming the actual image, so a storyboard frame that cannot work is
# rejected before it is paid for.
CN_IMAGE_MIN_SIDE = 300
CN_IMAGE_MAX_ASPECT = 2.5


class CnLineUnavailable(RuntimeError):
    """The CN line is switched off for this account, so the request never reached a model."""


class JojoKeyVideoModel(VideoGenModel):
    """Generate videos through the JojoKey relay."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._api_key = config.get("api_key")
        # CN asset handles, keyed by (modality, source url). Registration is billed per
        # asset, and the adapter is cached per worker, so a storyboard that reuses the same
        # character reference across shots pays for it once and skips the round trip after.
        self._asset_cache: Dict[Tuple[str, str], str] = {}

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

    def _resolved_urls(self, refs: List[str], *, model_id: str, modality: str) -> List[str]:
        """Turn project-side refs into public URLs JojoKey can fetch.

        Only used for the overseas line, which reads the URL itself, and for CN-line audio,
        which has no upload endpoint. CN images and videos go up as files instead — see
        `_cn_asset_for`, which needs no object storage of ours at all.
        """
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

    def _cn_asset_for(self, ref: str, *, model_id: str, modality: str,
                      group_id: Optional[str]) -> str:
        """Get a CN-line ``asset://`` handle for one project reference.

        A local file is uploaded directly. That matters more than it sounds: registering by
        URL requires a URL the vendor's upstream can reach, which would have made our own
        object storage a hard prerequisite for every i2v and r2v shot. Uploading sidesteps
        that entirely — JojoKey stores the file on their side and hands back the handle.

        Audio is the exception: it has no upload endpoint and must be registered from an
        HTTPS URL, so it still goes through media resolution.
        """
        if modality != "audio":
            local_path = resolve_local_media_path(ref, project_root=None) or (
                ref if os.path.isfile(ref) else None)
            if local_path:
                return self._upload_cn_asset(local_path, modality=modality, group_id=group_id,
                                             cache_key=ref)
        # Already a URL, an OSS object key, or audio: resolve to something fetchable first.
        url = self._resolved_urls([ref], model_id=model_id, modality=modality)[0]
        return self._register_cn_asset(url, modality=modality, group_id=group_id)

    def _upload_cn_asset(self, local_path: str, *, modality: str, group_id: Optional[str],
                         cache_key: str) -> str:
        cached = self._asset_cache.get((modality, cache_key))
        if cached:
            return cached

        if modality == "image":
            self._reject_unusable_image(local_path)

        base = get_provider_base_url("JOJOKEY")
        digest = self._file_digest(local_path)
        data = {"asset_type": str(CN_ASSET_TYPES[modality]),
                "asset_name": os.path.basename(local_path) or f"omni-{modality}"}
        if group_id:
            data["group_id"] = group_id
        with open(local_path, "rb") as handle:
            response = requests.post(
                f"{base}/video-cn/assets",
                headers=self._upload_headers(f"omni-asset:{modality}:{digest}"),
                files={"file": (os.path.basename(local_path), handle)},
                data=data,
                timeout=180,
            )
        self._ensure_success(response, "asset upload")
        asset_url = self._asset_url_from(response.json(), phase="upload")
        self._asset_cache[(modality, cache_key)] = asset_url
        return asset_url

    @staticmethod
    def _image_size(path: str) -> Optional[Tuple[int, int]]:
        """Read (width, height) from an image header, for the three formats the CN line takes.

        Done by hand rather than with Pillow: Pillow is not a declared dependency of this
        project — it is commented out in requirements.txt and nothing else imports it — so
        relying on it would make this check quietly vanish wherever it happens not to be
        installed. Returns None for anything unrecognised, which skips the check rather than
        blocking an upload over a header we cannot parse.
        """
        try:
            with open(path, "rb") as handle:
                head = handle.read(32)
                if head[:8] == b"\x89PNG\r\n\x1a\n" and head[12:16] == b"IHDR":
                    return (int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big"))
                if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                    chunk = head[12:16]
                    if chunk == b"VP8X":
                        # 24-bit canvas width/height, stored minus one.
                        return (int.from_bytes(head[24:27], "little") + 1,
                                int.from_bytes(head[27:30], "little") + 1)
                    if chunk == b"VP8 ":
                        # Frame header: 3-byte tag, 3-byte start code, then 14-bit dimensions.
                        return (int.from_bytes(head[26:28], "little") & 0x3FFF,
                                int.from_bytes(head[28:30], "little") & 0x3FFF)
                    if chunk == b"VP8L":
                        bits = int.from_bytes(head[21:25], "little")
                        return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
                if head[:2] == b"\xff\xd8":
                    handle.seek(2)
                    while True:
                        marker = handle.read(2)
                        if len(marker) < 2 or marker[0] != 0xFF:
                            return None
                        if marker[1] in (0xD8, 0xD9) or 0xD0 <= marker[1] <= 0xD7:
                            continue
                        length = int.from_bytes(handle.read(2), "big")
                        # Start-of-frame markers carry the dimensions; SOF4/SOF8/SOF12 do not.
                        if marker[1] in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                                         0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                            # Segment body: 1 byte sample precision, then height, then width.
                            body = handle.read(5)
                            return (int.from_bytes(body[3:5], "big"), int.from_bytes(body[1:3], "big"))
                        handle.seek(length - 2, os.SEEK_CUR)
        except OSError:
            return None
        return None

    def _reject_unusable_image(self, path: str) -> None:
        """Refuse an image the upstream will refuse anyway, while it is still free to do so."""
        size = self._image_size(path)
        if size is None:
            return
        width, height = size
        if min(width, height) <= 0:
            return
        aspect = max(width, height) / min(width, height)
        if min(width, height) < CN_IMAGE_MIN_SIDE:
            raise ValueError(
                f"参考图 {os.path.basename(path)} 为 {width}×{height}，短边不足 "
                f"{CN_IMAGE_MIN_SIDE}px，Seedance 国内线会拒绝。请换用更大的分镜图。")
        if aspect > CN_IMAGE_MAX_ASPECT:
            raise ValueError(
                f"参考图 {os.path.basename(path)} 为 {width}×{height}（{aspect:.2f}:1），"
                f"长宽比超过 {CN_IMAGE_MAX_ASPECT}:1，Seedance 国内线会拒绝。请裁成更接近方形的比例。")

    @staticmethod
    def _file_digest(path: str) -> str:
        """Content hash, so the same image is uploaded — and billed — once however it is
        reached. Registration costs ¥0.10 an asset, and a storyboard reuses references
        across many shots."""
        digest = hashlib.sha1()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        return digest.hexdigest()[:20]

    def _upload_headers(self, idempotency_key: str) -> Dict[str, str]:
        # requests sets the multipart Content-Type with its boundary; setting it here breaks it.
        return {"Authorization": f"Bearer {self.api_key}",
                "Idempotency-Key": self._header_safe_key(idempotency_key)}

    def _asset_url_from(self, body: Dict[str, Any], *, phase: str) -> str:
        """Get a reference the CN line will actually accept for a registered asset.

        Their own ``source_url`` is used in preference to the ``asset://`` handle, even
        though the handle is what the docs tell you to put in ``content[]``. The handle is
        currently refused: a freshly registered asset sitting at registration_state
        "registered" with sync_status 2 comes back InvalidVideoCnAsset — "无权使用或无法供
        目标上游读取" — for first_frame, for reference_image, and for the raw asset id, while
        the same file submitted as its plain https source_url is accepted and renders
        (verified end to end on 2026-09-16, task cnvid_89a20ed14f473c33). source_url points
        at the supplier's own domestic bucket, so it needs no object storage of ours and is
        reachable from inside China by construction. The handle stays as the fallback so
        this reverts to the documented path the moment they fix it.

        The reference is not always in the first response either: a registration still being
        submitted answers with both fields empty and fills them in later, so empty means
        "poll", not "failed" — raising on it turned every slow registration into an error
        that dumped the whole response body.
        """
        def reference(payload: Dict[str, Any]) -> Optional[str]:
            return (payload.get("source_url") or payload.get("asset_url")
                    or payload.get("url") or None)

        direct = reference(body)
        if direct and self._asset_is_ready(body):
            return str(direct)
        synced = self._await_asset(get_provider_base_url("JOJOKEY"), str(body.get("id") or ""), body)
        resolved = reference(synced) or direct
        if not resolved:
            raise RuntimeError(f"JojoKey asset {phase} produced no usable reference: {synced or body}")
        return str(resolved)

    @staticmethod
    def _registration_failure(body: Dict[str, Any]) -> Optional[str]:
        """The reason a registration will never complete, if it has one.

        The operation carries this, not the asset: a refused image sits at
        registration_state "pending" with an operation in state "unknown" and error_code
        "submission_unknown", and waiting longer does not change it.
        """
        operation = body.get("operation") or {}
        code = operation.get("error_code") or ""
        state = str(operation.get("state") or "").lower()
        if not code and state not in _TERMINAL_FAILURES:
            return None
        if code == "submission_unknown":
            # Measured cause: the upstream refuses the image and reports nothing specific.
            return ("上游拒绝了这张参考图且未说明原因（submission_unknown）。已知触发条件是"
                    f"短边小于 {CN_IMAGE_MIN_SIDE}px 或长宽比超过 {CN_IMAGE_MAX_ASPECT}:1。"
                    f"本次登记已预扣 ¥{operation.get('held_cny', 0.1)}。")
        return code or f"registration {state}"

    def _register_cn_asset(self, url: str, *, modality: str, group_id: Optional[str]) -> str:
        """Register a public URL as a CN-line ``asset://`` handle.

        The CN line takes ``asset://`` references in ``content[]`` rather than raw URLs, so
        every image and video goes through here first. Three things the docs understate:

        * This endpoint requires an Idempotency-Key. They only mention needing one for asset
          groups and for submission, but a registration without it is refused outright.
        * Registration costs money (¥0.10 an asset at the time of writing), so the key is
          derived from the source URL alone and nothing job-specific. The same reference image
          reused across a hundred shots is then registered — and charged — once.
        * Registration is asynchronous. It returns ``sync_status: 1`` / ``ready: false``, and
          submitting against an asset in that state is rejected as InvalidVideoCnAsset.
        """
        cached = self._asset_cache.get((modality, url))
        if cached:
            return cached

        base = get_provider_base_url("JOJOKEY")
        digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:20]
        payload: Dict[str, Any] = {
            "url": url,
            "asset_type": CN_ASSET_TYPES[modality],
            "asset_name": os.path.basename(url.split("?")[0]) or f"omni-{modality}",
        }
        if group_id:
            payload["group_id"] = group_id
        response = requests.post(
            f"{base}/video-cn/assets/from-url",
            headers=self._headers(idempotency_key=f"omni-asset:{modality}:{digest}"),
            json=payload,
            timeout=60,
        )
        self._ensure_success(response, "asset registration")
        asset_url = self._asset_url_from(response.json(), phase="registration")
        self._asset_cache[(modality, url)] = asset_url
        return asset_url

    @staticmethod
    def _asset_is_ready(body: Dict[str, Any]) -> bool:
        # sync_status 2 is the vendor's "synced, safe to use"; `ready` mirrors it.
        return bool(body.get("ready")) or body.get("sync_status") == 2

    def _await_asset(self, base: str, asset_id: str, first: Dict[str, Any]) -> Dict[str, Any]:
        """Poll a freshly registered asset until the upstream can read it.

        Returns the response that reported it ready, because that is where the handle is when
        the first response came back without one.
        """
        if not asset_id:
            raise RuntimeError(f"JojoKey asset is not synced and has no id to poll: {first}")
        # A refusal is already visible in the first response, so check before waiting at all.
        refused = self._registration_failure(first)
        if refused:
            raise RuntimeError(f"JojoKey 素材登记失败：{refused}")
        deadline = self._env_number("JOJOKEY_ASSET_SYNC_SECONDS", DEFAULT_ASSET_SYNC_SECONDS)
        waited = 0
        body = first
        while waited < deadline:
            time.sleep(ASSET_POLL_INTERVAL_SECONDS)
            waited += ASSET_POLL_INTERVAL_SECONDS
            response = requests.get(f"{base}/video-cn/assets/{asset_id}",
                                    headers=self._headers(), timeout=30)
            self._ensure_success(response, "asset sync check")
            body = response.json()
            if self._asset_is_ready(body):
                logger.info("[JojoKey] Asset %s synced after %ss", asset_id, waited)
                return body
            refused = self._registration_failure(body)
            if refused:
                raise RuntimeError(f"JojoKey 素材登记失败：{refused}")
            error = (body.get("operation") or {}).get("result", {}).get("sync_error") or ""
            if error:
                raise RuntimeError(f"JojoKey asset {asset_id} failed to sync: {error}")
        raise RuntimeError(
            f"JojoKey asset {asset_id} was still unsynced after {deadline}s "
            f"(registration_state={body.get('registration_state')!r}). A registration by URL "
            "needs the source reachable from inside China; an uploaded file should not stall, "
            "so a stall here is worth reporting to the supplier.")

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

        image_refs = ([first_frame] if first_frame else []) + ref_images
        video_refs = [url for url in (kwargs.get("ref_video_urls") or []) if url]
        audio_refs = [url for url in ([kwargs.get("audio_url")] if kwargs.get("audio_url") else []) if url]

        if line == "cn":
            # The CN line wants asset:// handles, and a local file can be uploaded straight
            # to it — so a storyboard frame reaches the model without our own object storage
            # being configured at all.
            group_id = kwargs.get("asset_group_id")
            image_urls = [self._cn_asset_for(ref, model_id=model_id, modality="image", group_id=group_id)
                          for ref in image_refs]
            video_urls = [self._cn_asset_for(ref, model_id=model_id, modality="video", group_id=group_id)
                          for ref in video_refs]
            audio_urls = [self._cn_asset_for(ref, model_id=model_id, modality="audio", group_id=group_id)
                          for ref in audio_refs]
        else:
            # The overseas line fetches the URL itself, so the reference has to be reachable.
            image_urls = self._resolved_urls(image_refs, model_id=model_id, modality="image")
            video_urls = self._resolved_urls(video_refs, model_id=model_id, modality="video")
            audio_urls = self._resolved_urls(audio_refs, model_id=model_id, modality="audio")

        resolved_first_frame = image_urls[0] if first_frame and image_urls else None
        resolved_references = image_urls if not first_frame else []
        if dialect == DIALECT_MINIMAX_A:
            if kwargs.get("last_frame"):
                if not resolved_first_frame or resolved_references or video_urls or audio_urls:
                    raise ValueError("MiniMax last frame requires keyframe mode without reference media")
                kwargs = {**kwargs, "last_frame": self._resolved_urls(
                    [kwargs["last_frame"]], model_id=model_id, modality="image")[0]}
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
