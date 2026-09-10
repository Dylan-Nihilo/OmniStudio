"""Where generation meets the wallet.

``JobBillingHook`` plugs into ``JobRepository``: when a job item is created its
``payload["billing"]`` spec (model, spec params, quantity) is quoted and the credits are
frozen in the same transaction; when the item reaches a terminal status the hold is
settled against the actual output (seconds via ffprobe, images via media refs) or
released. ``TextMeter`` charges LLM/TTS usage after the fact, capped at the available
balance. Everything is a no-op unless ``OMNI_STUDIO_BILLING_ENABLED`` is truthy.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from contextvars import ContextVar
from pathlib import Path
from typing import Any

from sqlalchemy.engine import Connection

from ..utils.model_catalog import CatalogAccessor, get_catalog_accessor
from . import BillingServices
from .errors import BillingError
from .pricing import Quote

logger = logging.getLogger(__name__)

BILLING_ENABLED_ENV = "OMNI_STUDIO_BILLING_ENABLED"
TEXT_HOLD_SAFETY = 1.3

# Set by the auth middleware for the request and copied into background tasks by _context_call.
current_workspace_id: ContextVar[str | None] = ContextVar("current_workspace_id", default=None)
current_actor_user_id: ContextVar[str | None] = ContextVar("current_actor_user_id", default=None)

_SIZE_RE = re.compile(r"(\d+)\s*[x*×]\s*(\d+)", re.IGNORECASE)


def billing_enabled() -> bool:
    return os.environ.get(BILLING_ENABLED_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def size_tier(size: Any) -> str | None:
    """'1280*1280' -> '2K'; pixel tiers match how vendors price images."""
    if not size:
        return None
    if isinstance(size, str) and size.upper() in {"1K", "2K", "4K"}:
        return size.upper()
    match = _SIZE_RE.search(str(size))
    if not match:
        return None
    longest = max(int(match.group(1)), int(match.group(2)))
    if longest <= 1024:
        return "1K"
    if longest <= 2048:
        return "2K"
    return "4K"


def normalize_params(stage: str, raw: dict[str, Any] | None) -> dict[str, Any]:
    """Reduce a provider request to the keys price items match on."""
    raw = raw or {}
    params: dict[str, Any] = {}
    if stage == "video":
        if raw.get("resolution"):
            params["resolution"] = str(raw["resolution"])
        if raw.get("mode"):
            params["mode"] = str(raw["mode"])
        audio = raw.get("audio")
        if audio is None:
            audio = raw.get("sound")
        if audio is None and raw.get("audio_mode") not in (None, "", "none", "off", False):
            audio = bool(raw.get("audio_mode"))
        if audio:
            params["audio"] = True
    elif stage == "image":
        tier = size_tier(raw.get("size") or raw.get("effective_size") or raw.get("resolution"))
        if tier:
            params["size_tier"] = tier
        if raw.get("quality"):
            params["quality"] = str(raw["quality"])
    elif stage == "text":
        if raw.get("direction"):
            params["direction"] = raw["direction"]
    elif stage == "tts":
        if raw.get("variant"):
            params["variant"] = raw["variant"]
    return params


def resolve_model_id(model_id: str, catalog: CatalogAccessor | None) -> str:
    """Legacy flat ids ('wan2.7-i2v') become canonical mode ids; text/tts ids pass through."""
    if not model_id:
        raise BillingError("PRICING_ITEM_NOT_FOUND", "缺少模型标识，无法计费", status_code=422)
    if "#" in model_id or model_id.startswith(("text/", "tts/")):
        return model_id
    if catalog is not None:
        canonical = catalog.resolve_legacy_to_canonical(model_id)
        if canonical:
            return canonical
    return model_id


def probe_duration_seconds(uri: str, output_root: str | Path = "output") -> float | None:
    """Duration of a locally stored video; None for remote URIs or when ffprobe is unavailable."""
    if not uri or uri.startswith(("http://", "https://")):
        return None
    path = Path(uri)
    if not path.is_absolute():
        path = Path(output_root) / uri
    if not path.is_file():
        return None
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        try:
            from ..utils.system_check import get_ffprobe_path
            ffprobe = get_ffprobe_path()
        except Exception:  # noqa: BLE001
            ffprobe = None
    if not ffprobe:
        return None
    try:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=20, check=False,
        )
        value = float(result.stdout.strip().splitlines()[0])
        return value if value > 0 else None
    except (ValueError, IndexError, subprocess.SubprocessError, OSError):
        return None


class JobBillingHook:
    """Freeze on create, settle/release on terminal transition. Attached to JobRepository."""

    def __init__(self, services: BillingServices, *, catalog: CatalogAccessor | None = None,
                 enabled: bool | None = None, output_root: str | Path = "output") -> None:
        self.services = services
        self._catalog = catalog
        self._enabled = enabled
        self.output_root = output_root

    @property
    def enabled(self) -> bool:
        return billing_enabled() if self._enabled is None else self._enabled

    @property
    def catalog(self) -> CatalogAccessor | None:
        if self._catalog is None:
            try:
                self._catalog = get_catalog_accessor()
            except Exception:  # noqa: BLE001 - catalog is optional for text/tts ids
                logger.warning("model catalog unavailable; legacy model ids will not be resolved for billing")
        return self._catalog

    # ---- quoting --------------------------------------------------------
    def quote_spec(self, spec: dict[str, Any], *, version: int | None = None, quantity: float | None = None) -> Quote:
        stage = str(spec.get("stage") or "")
        model_id = resolve_model_id(str(spec.get("model_id") or ""), self.catalog)
        params = normalize_params(stage, spec.get("params"))
        qty = float(quantity if quantity is not None else spec.get("quantity") or 1)
        snapshot = self.services.runtime.at_version(version) if version else self.services.runtime.require_current()
        try:
            return snapshot.quote(model_id, params, qty)
        except KeyError as exc:
            raise BillingError("PRICING_ITEM_NOT_FOUND", f"没有 {model_id} {params} 的积分定价",
                               status_code=422) from exc

    # ---- JobRepository hooks -------------------------------------------
    def before_create(self, connection: Connection, *, workspace_id: str, item_id: str, kind: str,
                      payload: dict[str, Any]) -> dict[str, Any]:
        """Quote + hold inside the create_item transaction; returns the payload to persist."""
        spec = payload.get("billing")
        if not self.enabled or not isinstance(spec, dict) or not spec.get("model_id"):
            return payload
        quote = self.quote_spec(spec)
        wallet = self.services.wallets.for_workspace(workspace_id)
        held = self.services.wallets.hold_in(connection, wallet["id"], item_id, quote,
                                             actor_user_id=current_actor_user_id.get())
        record = {
            **spec,
            "model_id": resolve_model_id(str(spec["model_id"]), self.catalog),
            "wallet_id": wallet["id"], "item_id": quote.item_id, "unit_credits": quote.unit_credits,
            "credits": quote.credits, "quantity": quote.quantity, "price_book_version": quote.price_book_version,
            "held": held,
        }
        return {**payload, "billing": record}

    def on_terminal(self, connection: Connection, *, item_id: str, status: str, payload: dict[str, Any],
                    media_refs: list[dict[str, Any]]) -> None:
        record = payload.get("billing")
        if not isinstance(record, dict) or not record.get("held"):
            return
        if status != "succeeded":
            self.services.wallets.release_in(connection, item_id, reason=status)
            return
        actual = self._actual_quote(record, media_refs)
        self.services.wallets.settle_in(connection, item_id, actual)

    def _actual_quote(self, record: dict[str, Any], media_refs: list[dict[str, Any]]) -> Quote | None:
        stage = record.get("stage")
        quoted = float(record.get("quantity") or 1)
        version = record.get("price_book_version")
        if stage == "video":
            seconds = 0.0
            for ref in media_refs:
                if ref.get("kind") not in (None, "video"):
                    continue
                probed = probe_duration_seconds(str(ref.get("uri") or ""), self.output_root)
                seconds += probed if probed is not None else quoted / max(len(media_refs), 1)
            actual = seconds if seconds > 0 else quoted
        elif stage == "image":
            images = [ref for ref in media_refs if ref.get("kind") in (None, "image")]
            actual = float(len(images)) if images else quoted
        else:
            actual = quoted
        try:
            return self.quote_spec(record, version=version, quantity=actual)
        except BillingError:
            logger.warning("billing: could not re-quote %s at version %s; settling the full hold", record.get("item_id"), version)
            return None


class TextMeter:
    """Post-paid LLM / TTS usage. Refuses to start work when the wallet is empty."""

    def __init__(self, services: BillingServices, *, enabled: bool | None = None) -> None:
        self.services = services
        self._enabled = enabled

    @property
    def enabled(self) -> bool:
        return billing_enabled() if self._enabled is None else self._enabled

    def _wallet_id(self, workspace_id: str | None) -> str | None:
        if not self.enabled or not workspace_id:
            return None
        return self.services.wallets.for_workspace(workspace_id)["id"]

    def ensure_available(self, workspace_id: str | None, minimum: int = 1) -> None:
        wallet_id = self._wallet_id(workspace_id)
        if wallet_id is None:
            return
        if self.services.wallets.balance(wallet_id)["available"] < minimum:
            raise BillingError("INSUFFICIENT_CREDITS", "积分不足，无法继续生成", status_code=402)

    def charge_tokens(self, workspace_id: str | None, model_id: str, tokens_in: int, tokens_out: int,
                      idempotency_key: str) -> int:
        wallet_id = self._wallet_id(workspace_id)
        if wallet_id is None:
            return 0
        quote = self.services.runtime.quote_text(f"text/{model_id}" if "/" not in model_id else model_id,
                                                  tokens_in, tokens_out)
        return self.services.wallets.debit(wallet_id, quote, idempotency_key, reason=f"llm:{model_id}")

    def charge_chars(self, workspace_id: str | None, model_id: str, chars: int, idempotency_key: str,
                     variant: str | None = None) -> int:
        wallet_id = self._wallet_id(workspace_id)
        if wallet_id is None:
            return 0
        params = {"variant": variant} if variant else {}
        quote = self.services.runtime.quote(f"tts/{model_id}" if "/" not in model_id else model_id, params, chars / 10_000)
        return self.services.wallets.debit(wallet_id, quote, idempotency_key, reason=f"tts:{model_id}")


def billing_hook_for(app_state: Any) -> JobBillingHook | None:
    """Cached JobBillingHook for an app's BillingServices, or None when billing is not wired."""
    services = getattr(app_state, "billing", None)
    if services is None:
        return None
    hook = getattr(app_state, "billing_job_hook", None)
    if hook is None or hook.services is not services:
        hook = JobBillingHook(services)
        app_state.billing_job_hook = hook
    return hook


def text_meter_for(app_state: Any) -> TextMeter | None:
    services = getattr(app_state, "billing", None)
    if services is None:
        return None
    meter = getattr(app_state, "billing_text_meter", None)
    if meter is None or meter.services is not services:
        meter = TextMeter(services)
        app_state.billing_text_meter = meter
    return meter


__all__ = [
    "BILLING_ENABLED_ENV", "billing_hook_for", "text_meter_for", "JobBillingHook", "TextMeter", "billing_enabled", "current_actor_user_id",
    "current_workspace_id", "normalize_params", "probe_duration_seconds", "resolve_model_id", "size_tier",
]
