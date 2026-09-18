"""
LLM Adapter - Unified interface for DashScope and OpenAI-compatible APIs.

Supports two providers:
  - dashscope (default): Alibaba Cloud DashScope via OpenAI-compatible endpoint
  - openai: Any OpenAI-compatible API (OpenAI, DeepSeek, Ollama, etc.)

Configuration via environment variables:
  LLM_PROVIDER=dashscope|openai
  DASHSCOPE_API_KEY=...
  OPENAI_API_KEY=...
  OPENAI_BASE_URL=https://api.openai.com/v1
  OPENAI_MODEL=gpt-4o
"""
import logging
import time
import uuid
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from ...utils.endpoints import get_provider_base_url
from ...utils.workspace_env import workspace_getenv

logger = logging.getLogger(__name__)

# A rate limit says "later", not "no", but nothing here used to retry one: a single 429
# anywhere in a long job — script analysis makes a call per chapter — threw the whole run
# away. Attempts are few and the waits short, because the caller is a person watching a
# progress bar; anything longer should surface rather than hang.
RATE_LIMIT_BACKOFF_SECONDS = (2.0, 5.0, 11.0)


def _retry_after_seconds(error: Exception) -> Optional[float]:
    """Honour the upstream's own Retry-After when it sends one."""
    response = getattr(error, "response", None)
    header = getattr(response, "headers", None) or {}
    try:
        value = float(header.get("Retry-After") or header.get("retry-after") or 0)
    except (TypeError, ValueError):
        return None
    # Ignore an implausible wait: a person is watching, and we would rather report the
    # limit than sit silently for minutes.
    return value if 0 < value <= 30 else None


def _is_rate_limited(error: Exception) -> bool:
    if getattr(error, "status_code", None) == 429 or type(error).__name__ == "RateLimitError":
        return True
    status = getattr(getattr(error, "response", None), "status_code", None)
    if status == 429:
        return True
    text = str(error)
    return "429" in text and ("rate" in text.lower() or "too many" in text.lower())


def _with_rate_limit_retry(call, model: str):
    """Run `call`, waiting out a rate limit a few times before giving up.

    The error is logged with the model on it: a bare "429" in a toast says nothing about
    which tier ran out of room, and that is the one fact needed to act on it.
    """
    last: Optional[Exception] = None
    for attempt, backoff in enumerate((*RATE_LIMIT_BACKOFF_SECONDS, None)):
        try:
            return call()
        except Exception as error:
            if not _is_rate_limited(error) or backoff is None:
                raise
            last = error
            wait = _retry_after_seconds(error) or backoff
            logger.warning("Rate limited by the text provider on %s (attempt %d); "
                           "retrying in %.0fs", model or "the default model", attempt + 1, wait)
            time.sleep(wait)
    raise last if last else RuntimeError("rate limit retry exhausted")


class LLMAdapter:
    """Unified LLM call interface supporting DashScope and OpenAI-compatible APIs."""

    def __init__(self):
        self._client = None
        self._client_fingerprint = None
        self._client_lock = Lock()
        logger.info(f"LLM Adapter initialized with provider: {self.provider}")

    @property
    def provider(self) -> str:
        return (workspace_getenv("LLM_PROVIDER", "dashscope") or "dashscope").lower()

    @property
    def is_configured(self) -> bool:
        """Whether a call would find a credential — answered by the resolver the call path
        itself uses.

        Asking a different question here is how script analysis came to refuse work on a
        platform where all three tiers answered: this checked OPENAI_API_KEY, which no tier
        uses since the keys became per-model, so the gate said "not configured" while the
        very next line of code would have succeeded. Readiness and the call must read the
        same thing or the product lies about its own state.
        """
        if self.provider == "openai":
            return bool(self.credential_for()[1])
        return bool(workspace_getenv("DASHSCOPE_API_KEY"))

    def credential_for(self, model: Optional[str] = None) -> Tuple[str, Optional[str]]:
        """(variable name, value) of the credential a call with this model would use.

        The name is returned too so a failure can say which variable to go and set, rather
        than naming one that was never consulted.
        """
        env_key = self._credential_env_for(model or self._get_default_model()) or "OPENAI_API_KEY"
        return env_key, (workspace_getenv(env_key) or "").strip() or None

    @staticmethod
    def _credential_env_for(model: str) -> Optional[str]:
        """Which environment variable holds the key for this model, per the catalog.

        The relay scopes a key to one model group, so the tiers do not share a credential —
        each key can only see its own models. The mapping lives on the catalog mode rather
        than in code so adding or re-pointing a tier stays a YAML edit.
        """
        if not model:
            return None
        try:
            from ...utils.model_catalog import get_catalog_accessor

            accessor = get_catalog_accessor()
            for candidate in (model, f"text/{model}"):
                canonical = accessor.resolve_legacy_to_canonical(candidate)
                if canonical:
                    runtime = accessor.get_mode_runtime(canonical) or {}
                    env_key = (runtime.get("newapi") or {}).get("api_key_env")
                    if env_key:
                        return str(env_key)
            # Fall back to matching on the name actually sent upstream.
            for mode in (accessor.get_mode_entry(mode_id) or {}
                         for mode_id in accessor.all_canonical_mode_ids()):
                runtime = (mode.get("runtime") or {}).get("newapi") or {}
                if runtime.get("api_model_id") == model and runtime.get("api_key_env"):
                    return str(runtime["api_key_env"])
        except Exception as error:               # catalog problems must not block a call
            logger.warning("Could not resolve a credential for text model %s: %s", model, error)
        return None

    def _get_client(self, model: Optional[str] = None):
        """Get or create the OpenAI-compatible client (lazy, cached).

        The key depends on the model when the relay scopes credentials per group, so the
        cache is keyed by it too — otherwise a second tier would reuse the first tier's
        client and be refused.
        """
        provider = self.provider
        if provider == "openai":
            # Resolve against the model that will actually be sent, not the argument: a
            # caller that names no model still gets the default one, and that default has a
            # key of its own. Reading the argument alone looked up "" and fell through to
            # OPENAI_API_KEY, which no tier uses — the vision route, which never names a
            # model, failed with "Missing credentials" while its key sat configured.
            _, api_key = self.credential_for(model)
            base_url = workspace_getenv("OPENAI_BASE_URL", "https://api.openai.com/v1") or "https://api.openai.com/v1"
        else:
            api_key = workspace_getenv("DASHSCOPE_API_KEY")
            base_url = f"{get_provider_base_url('DASHSCOPE')}/compatible-mode/v1"
        fingerprint = (provider, api_key, base_url)

        with self._client_lock:
            if self._client is not None and self._client_fingerprint == fingerprint:
                return self._client
            try:
                from openai import OpenAI
            except ImportError:
                raise RuntimeError(
                    "openai package not installed. Run: pip install openai>=1.0.0"
                )

            self._client = OpenAI(api_key=api_key, base_url=base_url)
            self._client_fingerprint = fingerprint
            return self._client

    # DashScope qwen 系列：首选 qwen3.7-plus（最新），不可用时回退到 qwen3.6-plus，
    # 最终回退到 qwen-plus alias（始终指向最新稳定通用版）。
    # 维护 fallback chain 而不是硬写一个名字，避免新版本上下线时整条 LLM 链断掉。
    _DASHSCOPE_MODEL_FALLBACK_CHAIN = ["qwen3.7-plus", "qwen3.6-plus", "qwen-plus"]

    def _get_default_model(self) -> str:
        if self.provider == "openai":
            return workspace_getenv("OPENAI_MODEL", "gpt-4o") or "gpt-4o"
        return self._DASHSCOPE_MODEL_FALLBACK_CHAIN[0]

    def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        Send a chat completion request and return the response content.

        Args:
            messages: List of {"role": ..., "content": ...} dicts
            model: Model name override (uses provider default if None)
            response_format: Optional {"type": "json_object"} constraint

        Returns:
            The assistant's response content as a string.

        Raises:
            RuntimeError: If the API call fails.
        """
        client = self._get_client(model)

        # 显式 model override 路径：单次尝试，失败就抛。
        if model:
            return self._chat_once(client, model, messages, response_format)

        # Provider 默认路径：DashScope 走 fallback chain，OpenAI 单次尝试。
        if self.provider == "openai":
            return self._chat_once(client, self._get_default_model(), messages, response_format)

        last_err: Optional[Exception] = None
        for idx, candidate in enumerate(self._DASHSCOPE_MODEL_FALLBACK_CHAIN):
            try:
                return self._chat_once(client, candidate, messages, response_format)
            except RuntimeError as e:
                # 仅在 "模型不存在 / 不可用" 类错误时回退；其他错误（鉴权、限流、网络）
                # 直接抛，不浪费第二次重试。判定关键字宽松匹配 DashScope 文案。
                msg = str(e).lower()
                is_model_unavailable = any(k in msg for k in (
                    "model not found", "invalidmodel", "model_not_found",
                    "no such model", "not supported", "modelnotfound", "404",
                ))
                last_err = e
                if is_model_unavailable and idx < len(self._DASHSCOPE_MODEL_FALLBACK_CHAIN) - 1:
                    next_candidate = self._DASHSCOPE_MODEL_FALLBACK_CHAIN[idx + 1]
                    logger.warning(
                        "DashScope model %s unavailable (%s); falling back to %s",
                        candidate, e, next_candidate,
                    )
                    continue
                raise
        # 理论上不可达（最后一次失败已 raise），保留兜底
        raise last_err if last_err else RuntimeError("DashScope: no models available")

    @staticmethod
    def _open_stream(client, kwargs: Dict[str, Any]):
        """Open the stream, asking for usage totals but not insisting on them.

        `stream_options` is how the usage numbers arrive, and they go into the ledger for
        audit. Some relay channels reject the field outright — kaizo.top's Claude group
        answers "stream_options: Extra inputs are not permitted" — and a tier that cannot
        run is a worse outcome than a ledger entry without a token count, since text is
        charged per character anyway. Only that specific rejection is retried.
        """
        def open_it():
            try:
                return client.chat.completions.create(**kwargs, stream=True,
                                                      stream_options={"include_usage": True})
            except Exception as error:
                if "stream_options" not in str(error):
                    raise
                logger.info("Upstream rejects stream_options; retrying without usage reporting")
                return client.chat.completions.create(**kwargs, stream=True)

        return _with_rate_limit_retry(open_it, str(kwargs.get("model") or ""))

    def _chat_once(
        self,
        client,
        model: str,
        messages: List[Dict[str, str]],
        response_format: Optional[Dict[str, str]],
    ) -> str:
        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": messages,
        }
        if response_format:
            kwargs["response_format"] = response_format

        try:
            if self.provider == "openai":
                # Kaizo can repeatedly fail an identical prompt on its default cache route.
                # Isolate each logical call; other compatible providers may reject this field.
                if urlsplit(workspace_getenv("OPENAI_BASE_URL", "") or "").hostname == "kaizo.top":
                    kwargs["prompt_cache_key"] = f"omni-{uuid.uuid4().hex}"
                # Receive upstream tokens as they arrive so a long JSON response
                # does not hit the gateway's non-streaming response timeout.
                parts = []
                finish_reason = None
                usage_response = None
                with self._open_stream(client, kwargs) as stream:
                    for chunk in stream:
                        if getattr(chunk, "usage", None) is not None:
                            usage_response = chunk
                        if not chunk.choices:
                            continue
                        choice = chunk.choices[0]
                        if choice.delta.content:
                            parts.append(choice.delta.content)
                        if choice.finish_reason:
                            finish_reason = choice.finish_reason
                if finish_reason != "stop" or not parts:
                    raise RuntimeError(f"Incomplete model response (finish_reason={finish_reason})")
                logger.info("LLM stream completed: model=%s, characters=%s", model, sum(map(len, parts)))
                content = "".join(parts)
                _charge_llm_usage(model, messages, content, usage_response)
                return content
            response = client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content
            _charge_llm_usage(model, messages, content, response)
            return content
        except Exception as e:
            provider_label = "DashScope" if self.provider != "openai" else "OpenAI"
            raise RuntimeError(f"{provider_label} API error: {e}") from e


def _charge_llm_usage(model: str, messages: List[Dict[str, str]], content: Optional[str], response: Any) -> None:
    """Charge the workspace for the characters this call read and wrote.

    Post-paid rather than pre-authorised: the size is only known afterwards, and a script
    analysis that already ran should not be thrown away over a rounding difference. The debit
    is capped at the available balance; the next call refuses to start when the wallet is empty.
    """
    from ...billing.metering import billing_enabled, current_workspace_id

    if not billing_enabled():
        return
    workspace_id = current_workspace_id.get()
    if not workspace_id:
        return
    try:
        from ...billing import BillingServices
        from ...billing.metering import TextMeter
        from ...storage.db import create_engine

        chars_in = sum(len(str(message.get("content") or "")) for message in messages)
        chars_out = len(content or "")
        usage = getattr(response, "usage", None)
        tokens = ""
        if usage is not None:
            tokens = (f"{int(getattr(usage, 'prompt_tokens', 0) or 0)}/"
                      f"{int(getattr(usage, 'completion_tokens', 0) or 0)}")
        meter = _text_meter or TextMeter(BillingServices.build(create_engine()))
        meter.charge_text(
            workspace_id, model, chars_in, chars_out,
            f"llm:{workspace_id}:{getattr(response, 'id', None) or uuid.uuid4()}",
            tokens=tokens,
        )
    except Exception:  # noqa: BLE001 - never fail a completed generation over accounting
        logger.exception("Failed to charge LLM usage for model %s", model)


_text_meter = None


def set_text_meter(meter: Any) -> None:
    """Injected at app startup so every LLM call bills through the app's BillingServices."""
    global _text_meter
    _text_meter = meter
