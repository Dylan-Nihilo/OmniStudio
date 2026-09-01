"""Playground service layer -- orchestrates AI generation by delegating to existing model adapters.

Routes based on model_id to the appropriate adapter (WanxModel, KlingModel,
ViduModel, MuleRouterVideoModel/ImageModel, WanxImageModel).  Mirrors the
routing logic in ``src/apps/comic_gen/pipeline.py:process_video_task()``.
"""

import os
import shutil
import uuid
from datetime import datetime, timezone
from typing import Optional

from .models import (
    GenerateRequest,
    PlaygroundGeneration,
    PlaygroundMode,
    PlaygroundOutput,
)
from .storage import PlaygroundStorage
from ...utils import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Output directories
# ---------------------------------------------------------------------------
IMAGE_OUTPUT_DIR = os.path.join("output", "playground", "images")
VIDEO_OUTPUT_DIR = os.path.join("output", "playground", "videos")


class PlaygroundService:
    """High-level service that creates generation records and delegates to
    the correct model adapter for execution."""

    def __init__(self, storage: PlaygroundStorage):
        self.storage = storage
        # Lazy-initialised model instances (cached for the lifetime of the service)
        self._wanx_model = None
        self._wanx_image_model = None
        self._kling_model = None
        self._vidu_model = None
        self._mulerouter_video_model = None
        self._mulerouter_image_model = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_generation(
        self,
        request: GenerateRequest,
        workspace_id: str | None = None,
    ) -> PlaygroundGeneration:
        """Create a :class:`PlaygroundGeneration` record with *status=pending*,
        persist it via storage, and return it."""
        gen = PlaygroundGeneration(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            mode=request.mode,
            model_id=request.model_id,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            input_media=request.input_media or [],
            parameters=request.parameters or {},
            batch_size=request.batch_size or 1,
            outputs=[],
            status="pending",
            error=None,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self.storage.add_generation(gen)
        return gen

    def process_generation(self, generation_id: str) -> None:
        """Execute the actual generation.  Intended to run in a background
        thread -- all calls are synchronous (blocking)."""
        gen = self.storage.get_generation(generation_id)
        if gen is None:
            logger.error("Generation %s not found", generation_id)
            return

        # Mark processing
        gen.status = "processing"
        self.storage.update_generation(gen)

        try:
            mode = gen.mode
            if mode in (PlaygroundMode.T2I, PlaygroundMode.I2I):
                self._process_image_generation(gen)
            elif mode in (PlaygroundMode.T2V, PlaygroundMode.I2V, PlaygroundMode.R2V, PlaygroundMode.V2V):
                self._process_video_generation(gen)
            else:
                raise ValueError(f"Unsupported playground mode: {mode}")

            gen.status = "completed"
        except Exception as exc:
            logger.exception("Generation %s failed", generation_id)
            gen.status = "failed"
            gen.error = str(exc)

        self.storage.update_generation(gen)

    def save_to_library(
        self,
        generation_id: str,
        output_id: str,
        category: str = "general",
        workspace_id: str | None = None,
    ) -> bool:
        """Copy a generated output to ``output/assets/{category}/`` and flag
        :pyattr:`PlaygroundOutput.saved_to_library` = True."""
        gen = self.storage.get_generation(generation_id, workspace_id)
        if gen is None:
            logger.warning("save_to_library: generation %s not found", generation_id)
            return False

        target_output: Optional[PlaygroundOutput] = None
        for out in gen.outputs:
            if out.id == output_id:
                target_output = out
                break
        if target_output is None:
            logger.warning("save_to_library: output %s not found in generation %s", output_id, generation_id)
            return False

        # media_path is stored as e.g. "output/playground/images/t2i_xxx_0.png"
        # Normalise: try as-is first, then strip leading "output/" and re-join
        src_path = target_output.media_path
        if not os.path.isfile(src_path):
            alt = os.path.join("output", target_output.media_path)
            if os.path.isfile(alt):
                src_path = alt
        if not os.path.isfile(src_path):
            logger.error("save_to_library: source file not found: %s", target_output.media_path)
            return False

        asset_type = self._category_to_asset_type(category)
        dest_dir = os.path.join("output", "assets", workspace_id or "legacy", asset_type)
        os.makedirs(dest_dir, exist_ok=True)

        dest_path = os.path.join(dest_dir, os.path.basename(src_path))
        shutil.copy2(src_path, dest_path)
        logger.info("Saved output %s to library: %s", output_id, dest_path)

        # Wave A (shared asset pool): besides copying the file, register a real
        # global library asset record so the output is curatable through the
        # /library/assets CRUD. category -> asset_type mapping; anything
        # unknown (incl. the "general" default) falls back to "prop".
        prompt_text = (gen.prompt or "").strip()
        asset_name = prompt_text[:40] or os.path.splitext(os.path.basename(dest_path))[0]
        try:
            # Deferred import: comic_gen.api owns the live ComicGenPipeline
            # singleton -- the same instance that backs the /library/assets
            # CRUD endpoints, so the new asset is immediately visible there.
            # A top-level import would create a cycle (comic_gen.api imports the
            # playground router at module load), so we import lazily at call
            # time when both modules are fully initialised.
            from ..comic_gen.api import pipeline as comic_pipeline

            asset = comic_pipeline.create_library_asset(
                asset_type,
                {
                    "name": asset_name,
                    "description": prompt_text,
                    # Point the library record at the freshly-copied file.
                    "image_url": dest_path,
                },
                workspace_id,
            )
            logger.info(
                "save_to_library: created global %s asset %s from output %s",
                asset_type,
                getattr(asset, "id", "?"),
                output_id,
            )
        except Exception:
            logger.exception(
                "save_to_library: failed to register global library asset for output %s",
                output_id,
            )
            return False

        target_output.saved_to_library = True
        self.storage.update_generation(gen)
        return True

    # ------------------------------------------------------------------
    # Image generation (t2i / i2i)
    # ------------------------------------------------------------------

    def _process_image_generation(self, gen: PlaygroundGeneration) -> None:
        output_dir = os.path.join(IMAGE_OUTPUT_DIR, gen.workspace_id or "legacy")
        os.makedirs(output_dir, exist_ok=True)

        model_lower = gen.model_id.lower()
        failures = []

        for idx in range(gen.batch_size):
            ext = "png"
            out_filename = f"{gen.mode.value}_{gen.id}_{idx}.{ext}"
            out_path = os.path.join(output_dir, out_filename)

            try:
                if model_lower.startswith("gpt-image"):
                    self._generate_image_mulerouter(gen, out_path, idx)
                else:
                    self._generate_image_wanx(gen, out_path, idx)

                output_entry = PlaygroundOutput(
                    id=str(uuid.uuid4()),
                    media_path=out_path,
                    media_type="image",
                )
                gen.outputs.append(output_entry)
                self.storage.update_generation(gen)
            except Exception as exc:
                logger.error("Image generation %s batch %d failed: %s", gen.id, idx, exc)
                failures.append(str(exc))

        if failures and not gen.outputs:
            raise RuntimeError(f"All {len(failures)} batch items failed: {failures[0]}")

    def _generate_image_wanx(self, gen: PlaygroundGeneration, out_path: str, _idx: int) -> None:
        """Delegate to :class:`WanxImageModel` (DashScope image generation)."""
        from ...models.image import WanxImageModel

        if self._wanx_image_model is None:
            self._wanx_image_model = WanxImageModel({})

        params = gen.parameters
        kwargs = {
            "model_name": gen.model_id,
            "size": params.get("size", "1280*1280"),
            "n": 1,
            "negative_prompt": gen.negative_prompt,
            "seed": params.get("seed"),
            "prompt_extend": params.get("prompt_extend", True),
            "watermark": params.get("watermark", False),
        }

        # i2i: attach reference images from input_media
        ref_paths = list(gen.input_media) if gen.mode == PlaygroundMode.I2I else []
        if ref_paths:
            kwargs["ref_image_paths"] = ref_paths

        self._wanx_image_model.generate(
            prompt=gen.prompt,
            output_path=out_path,
            **kwargs,
        )

    def _generate_image_mulerouter(self, gen: PlaygroundGeneration, out_path: str, _idx: int) -> None:
        """Delegate to :class:`MuleRouterImageModel` (GPT-Image-2)."""
        from ...models.mulerouter import MuleRouterImageModel

        if self._mulerouter_image_model is None:
            self._mulerouter_image_model = MuleRouterImageModel({})

        params = gen.parameters
        kwargs = {
            "size": params.get("size", "1024x1024"),
            "quality": params.get("quality", "high"),
            "n": 1,
        }

        # i2i: attach reference images
        if gen.mode == PlaygroundMode.I2I and gen.input_media:
            kwargs["ref_image_paths"] = list(gen.input_media)

        self._mulerouter_image_model.generate(
            prompt=gen.prompt,
            output_path=out_path,
            **kwargs,
        )

    # ------------------------------------------------------------------
    # Video generation (t2v / i2v / r2v / v2v)
    # ------------------------------------------------------------------

    def _process_video_generation(self, gen: PlaygroundGeneration) -> None:
        output_dir = os.path.join(VIDEO_OUTPUT_DIR, gen.workspace_id or "legacy")
        os.makedirs(output_dir, exist_ok=True)

        model_lower = gen.model_id.lower()
        failures = []

        for idx in range(gen.batch_size):
            out_filename = f"{gen.mode.value}_{gen.id}_{idx}.mp4"
            out_path = os.path.join(output_dir, out_filename)

            try:
                if model_lower.startswith("seedance"):
                    self._generate_video_mulerouter(gen, out_path)
                elif model_lower.startswith("kling"):
                    self._generate_video_kling(gen, out_path)
                elif model_lower.startswith("vidu") or model_lower.startswith("viduq"):
                    self._generate_video_vidu(gen, out_path)
                elif model_lower.startswith("happyhorse"):
                    self._generate_video_wanx(gen, out_path)
                elif model_lower.startswith("pixverse"):
                    self._generate_video_wanx(gen, out_path)
                else:
                    self._generate_video_wanx(gen, out_path)

                output_entry = PlaygroundOutput(
                    id=str(uuid.uuid4()),
                    media_path=out_path,
                    media_type="video",
                )
                gen.outputs.append(output_entry)
                self.storage.update_generation(gen)
            except Exception as exc:
                logger.error("Video generation %s batch %d failed: %s", gen.id, idx, exc)
                failures.append(str(exc))

        if failures and not gen.outputs:
            raise RuntimeError(f"All {len(failures)} batch items failed: {failures[0]}")

    # -- adapter delegates ------------------------------------------------

    def _generate_video_wanx(self, gen: PlaygroundGeneration, out_path: str) -> None:
        """Delegate to :class:`WanxModel` (DashScope video generation -- wan2.x / happyhorse)."""
        from ...models.wanx import WanxModel

        if self._wanx_model is None:
            self._wanx_model = WanxModel({})

        params = gen.parameters
        img_path, img_url = self._resolve_first_input_media(gen)

        kwargs = {
            "model": gen.model_id,
            "duration": params.get("duration", 5),
            "resolution": params.get("resolution", "720P"),
            "seed": params.get("seed"),
            "negative_prompt": gen.negative_prompt,
            "prompt_extend": params.get("prompt_extend", True),
            "watermark": params.get("watermark", False),
            "ratio": params.get("ratio"),
            "audio_url": params.get("audio_url"),
        }

        # r2v: reference images
        if gen.mode == PlaygroundMode.R2V and gen.input_media:
            kwargs["ref_image_urls"] = list(gen.input_media)

        # v2v: video input
        if gen.mode == PlaygroundMode.V2V and gen.input_media:
            kwargs["video_url"] = gen.input_media[0]

        self._wanx_model.generate(
            prompt=gen.prompt,
            output_path=out_path,
            img_path=img_path,
            img_url=img_url,
            **kwargs,
        )

    def _generate_video_mulerouter(self, gen: PlaygroundGeneration, out_path: str) -> None:
        """Delegate to :class:`MuleRouterVideoModel` (Seedance 2.0)."""
        from ...models.mulerouter import MuleRouterVideoModel

        if self._mulerouter_video_model is None:
            self._mulerouter_video_model = MuleRouterVideoModel({})

        params = gen.parameters
        img_path, img_url = self._resolve_first_input_media(gen)

        kwargs = {
            "duration": params.get("duration", 5),
            "resolution": params.get("resolution", "1080p"),
            "aspect_ratio": params.get("aspect_ratio", "16:9"),
            "seed": params.get("seed"),
            "watermark": params.get("watermark", False),
        }

        # r2v: reference images
        if gen.mode == PlaygroundMode.R2V and gen.input_media:
            kwargs["generation_mode"] = "r2v"
            kwargs["ref_image_urls"] = list(gen.input_media)

        self._mulerouter_video_model.generate(
            prompt=gen.prompt,
            output_path=out_path,
            img_url=img_url,
            img_path=img_path,
            **kwargs,
        )

    def _generate_video_kling(self, gen: PlaygroundGeneration, out_path: str) -> None:
        """Delegate to :class:`KlingModel`."""
        from ...models.kling import KlingModel

        if self._kling_model is None:
            self._kling_model = KlingModel({})

        params = gen.parameters
        img_path, img_url = self._resolve_first_input_media(gen)

        self._kling_model.generate(
            prompt=gen.prompt,
            output_path=out_path,
            img_url=img_url,
            img_path=img_path,
            duration=params.get("duration", 5),
            model=gen.model_id,
            negative_prompt=gen.negative_prompt,
            aspect_ratio=params.get("aspect_ratio", "16:9"),
            mode=params.get("mode", "std"),
            sound=params.get("sound", "off"),
            cfg_scale=params.get("cfg_scale"),
        )

    def _generate_video_vidu(self, gen: PlaygroundGeneration, out_path: str) -> None:
        """Delegate to :class:`ViduModel`."""
        from ...models.vidu import ViduModel

        if self._vidu_model is None:
            self._vidu_model = ViduModel({})

        params = gen.parameters
        img_path, img_url = self._resolve_first_input_media(gen)

        self._vidu_model.generate(
            prompt=gen.prompt,
            output_path=out_path,
            img_url=img_url,
            img_path=img_path,
            duration=params.get("duration", 5),
            model=gen.model_id,
            resolution=params.get("resolution", "720p"),
            aspect_ratio=params.get("aspect_ratio", "16:9"),
            seed=params.get("seed", 0),
            audio=params.get("audio", True),
            movement_amplitude=params.get("movement_amplitude", "auto"),
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _category_to_asset_type(category: Optional[str]) -> str:
        """Map a Playground save category to a global-library asset_type.

        Known categories (``character`` / ``scene`` / ``prop``) pass through;
        everything else -- including the ``"general"`` default, empty string,
        or ``None`` -- falls back to ``"prop"``."""
        normalized = (category or "").strip().lower()
        if normalized in ("character", "scene", "prop"):
            return normalized
        return "prop"

    @staticmethod
    def _resolve_first_input_media(gen: PlaygroundGeneration):
        """Return ``(img_path, img_url)`` for the first entry in
        :pyattr:`input_media`.  Local files are returned as *img_path*;
        remote URLs as *img_url*."""
        if not gen.input_media:
            return None, None

        first = gen.input_media[0]
        if first.startswith(("http://", "https://")):
            return None, first

        # Try as-is, then relative to output/
        if os.path.exists(first):
            return first, None
        candidate = os.path.join("output", first)
        if os.path.exists(candidate):
            return candidate, None

        # Fall back to treating it as a URL-like reference
        return None, first
