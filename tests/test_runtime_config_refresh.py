from __future__ import annotations

import openai
import pytest

from types import SimpleNamespace

from src.apps.comic_gen.api import (
    SECRET_FIELDS,
    EnvConfig,
    _context_call,
    _context_iterator,
    _mask_secret,
)
from src.apps.comic_gen.llm_adapter import LLMAdapter
from src.utils.workspace_env import (
    current_platform_config,
    current_workspace_config,
    workspace_getenv,
)


def test_a_workspace_inherits_platform_credentials_it_has_not_overridden(monkeypatch):
    """Deliberate reversal of the previous rule.

    This used to assert the opposite — a workspace config, even an empty one, answered every
    lookup and never fell back to the process environment. That suited a product where each
    workspace brought its own keys. It does not suit the one we now run: the platform holds
    the credentials, users only pick models and spend credits, and per-workspace metering
    (not credential isolation) is what keeps usage accountable.

    Under the old rule a single saved setting blanked every platform credential the workspace
    had not restated, which is how production ended up reading an empty OSS bucket while the
    value sat in .env the whole time.
    """
    monkeypatch.setenv("DASHSCOPE_API_KEY", "process-secret")
    assert workspace_getenv("DASHSCOPE_API_KEY") == "process-secret"

    token = current_workspace_config.set({})
    try:
        assert workspace_getenv("DASHSCOPE_API_KEY") == "process-secret"
    finally:
        current_workspace_config.reset(token)


def test_a_workspace_value_still_wins_over_the_platform_one(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "process-secret")
    token = current_workspace_config.set({"DASHSCOPE_API_KEY": "workspace-secret"})
    try:
        assert workspace_getenv("DASHSCOPE_API_KEY") == "workspace-secret"
    finally:
        current_workspace_config.reset(token)


def test_a_blank_workspace_value_does_not_shadow_the_platform_one(monkeypatch):
    """Saving a form with a field left empty must not wipe out the platform credential;
    clearing a setting on purpose means removing the key, not storing an empty string."""
    monkeypatch.setenv("OSS_BUCKET_NAME", "platform-bucket")
    token = current_workspace_config.set({"OSS_BUCKET_NAME": ""})
    try:
        assert workspace_getenv("OSS_BUCKET_NAME") == "platform-bucket"
    finally:
        current_workspace_config.reset(token)


def test_llm_adapter_rebuilds_cached_client_for_each_workspace(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "dashscope")
    created = []

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self.config = kwargs
            created.append(self)

    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    adapter = LLMAdapter()

    first_token = current_workspace_config.set(
        {
            "DASHSCOPE_API_KEY": "workspace-a",
            "DASHSCOPE_BASE_URL": "https://a.example",
        }
    )
    try:
        first = adapter._get_client()
        assert adapter._get_client() is first
    finally:
        current_workspace_config.reset(first_token)

    second_token = current_workspace_config.set(
        {
            "DASHSCOPE_API_KEY": "workspace-b",
            "DASHSCOPE_BASE_URL": "https://b.example",
        }
    )
    try:
        second = adapter._get_client()
    finally:
        current_workspace_config.reset(second_token)

    assert second is not first
    assert [client.config["api_key"] for client in created] == ["workspace-a", "workspace-b"]


def test_llm_adapter_uses_openai_compatible_workspace_config(monkeypatch):
    created = []

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self.config = kwargs
            created.append(self)

    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    adapter = LLMAdapter()
    token = current_workspace_config.set(
        {
            "LLM_PROVIDER": "openai",
            "OPENAI_API_KEY": "openai-workspace-key",
            "OPENAI_BASE_URL": "https://api.deepseek.com/v1",
            "OPENAI_MODEL": "deepseek-chat",
        }
    )
    try:
        client = adapter._get_client()
        assert adapter.provider == "openai"
        assert adapter.is_configured is True
        assert adapter._get_default_model() == "deepseek-chat"
    finally:
        current_workspace_config.reset(token)

    assert client.config == {
        "api_key": "openai-workspace-key",
        "base_url": "https://api.deepseek.com/v1",
    }


def test_context_call_keeps_workspace_config_after_request_context_resets():
    token = current_workspace_config.set({"DASHSCOPE_API_KEY": "workspace-a"})
    try:
        bound_call = _context_call(lambda: workspace_getenv("DASHSCOPE_API_KEY"))
    finally:
        current_workspace_config.reset(token)

    assert bound_call() == "workspace-a"


def test_context_iterator_keeps_workspace_config_while_streaming():
    token = current_workspace_config.set({"DASHSCOPE_API_KEY": "workspace-a"})
    try:
        stream = _context_iterator(
            workspace_getenv("DASHSCOPE_API_KEY") for _ in range(2)
        )
    finally:
        current_workspace_config.reset(token)

    assert list(stream) == ["workspace-a", "workspace-a"]


def test_openai_compatible_env_config_is_explicit_and_secret_is_masked():
    config = EnvConfig(
        LLM_PROVIDER="openai",
        OPENAI_API_KEY="sk-test-secret",
        OPENAI_BASE_URL="https://api.deepseek.com/v1",
        OPENAI_MODEL="deepseek-chat",
    )

    assert config.LLM_PROVIDER == "openai"
    assert config.OPENAI_BASE_URL == "https://api.deepseek.com/v1"
    assert config.OPENAI_MODEL == "deepseek-chat"
    assert "OPENAI_API_KEY" in SECRET_FIELDS
    assert _mask_secret(config.OPENAI_API_KEY) == "sk-••••••••cret"


def test_openai_compatible_image_env_config_is_explicit_and_secret_is_masked():
    config = EnvConfig(
        IMAGE_PROVIDER="openai",
        OPENAI_IMAGE_API_KEY="sk-image-secret",
        OPENAI_IMAGE_BASE_URL="https://api.kaizo.example/v1",
        OPENAI_IMAGE_MODEL="gpt-image-2",
    )

    assert config.IMAGE_PROVIDER == "openai"
    assert config.OPENAI_IMAGE_BASE_URL == "https://api.kaizo.example/v1"
    assert config.OPENAI_IMAGE_MODEL == "gpt-image-2"
    assert "OPENAI_IMAGE_API_KEY" in SECRET_FIELDS
    assert _mask_secret(config.OPENAI_IMAGE_API_KEY) == "sk-••••••••cret"


def test_moma_video_env_config_is_explicit_and_secret_is_masked():
    config = EnvConfig(MOMA_API_KEY="moma-secret")

    assert config.MOMA_API_KEY == "moma-secret"
    assert "MOMA_API_KEY" in SECRET_FIELDS
    assert _mask_secret(config.MOMA_API_KEY) == "••••••••cret"


def test_each_text_tier_resolves_its_own_credential():
    """The relay scopes a key to one model group, so the tiers cannot share a credential —
    a key can only see its own models. Reusing one key for another tier gets refused."""
    adapter = LLMAdapter()
    assert adapter._credential_env_for("gpt-5.6-sol") == "KAIZO_GPT_API_KEY"
    assert adapter._credential_env_for("claude-opus-5") == "KAIZO_CLAUDE_API_KEY"
    assert adapter._credential_env_for("DeepSeek-V4.1-Flash") == "KAIZO_DEEPSEEK_API_KEY"
    # An unknown model falls back to the generic key rather than failing to resolve.
    assert adapter._credential_env_for("something-else") is None


def test_the_client_cache_is_keyed_by_the_model_not_just_the_provider(monkeypatch):
    """Without this a second tier reuses the first tier's client, and its key cannot see the
    model it is being asked for."""
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("KAIZO_GPT_API_KEY", "sk-gpt")
    monkeypatch.setenv("KAIZO_CLAUDE_API_KEY", "sk-claude")
    created = []

    class FakeOpenAI:
        def __init__(self, api_key=None, base_url=None):
            created.append(api_key)

    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    adapter = LLMAdapter()
    adapter._get_client("gpt-5.6-sol")
    adapter._get_client("claude-opus-5")
    adapter._get_client("gpt-5.6-sol")
    assert created == ["sk-gpt", "sk-claude", "sk-gpt"]


def test_a_relay_that_rejects_stream_options_still_runs(monkeypatch):
    """kaizo.top's Claude group answers "stream_options: Extra inputs are not permitted".
    Usage totals are an audit nicety — text is charged per character — so losing them beats
    losing the tier."""
    attempts = []

    class FakeStream:
        def __enter__(self): return iter(())
        def __exit__(self, *exc): return False

    def create(**kwargs):
        attempts.append("stream_options" in kwargs)
        if "stream_options" in kwargs:
            raise RuntimeError("Error code: 400 - stream_options: Extra inputs are not permitted")
        return FakeStream()

    client = type("C", (), {"chat": type("Ch", (), {"completions": type("Co", (), {"create": staticmethod(create)})()})()})()
    LLMAdapter._open_stream(client, {"model": "claude-opus-5", "messages": []})
    assert attempts == [True, False], "usage is asked for first, then dropped on refusal"


def test_an_unrelated_upstream_error_is_not_swallowed():
    def create(**kwargs):
        raise RuntimeError("Error code: 401 - invalid api key")

    client = type("C", (), {"chat": type("Ch", (), {"completions": type("Co", (), {"create": staticmethod(create)})()})()})()
    import pytest

    with pytest.raises(RuntimeError, match="invalid api key"):
        LLMAdapter._open_stream(client, {"model": "x", "messages": []})


def test_a_caller_that_names_no_model_still_gets_the_default_tiers_key(monkeypatch):
    """The vision route never names a model — it relies on OPENAI_MODEL. Resolving the
    credential from the argument alone looked up "" and fell through to OPENAI_API_KEY,
    which no tier uses, so prompt optimisation failed with "Missing credentials" while the
    key it needed sat configured all along."""
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.6-sol")
    monkeypatch.setenv("KAIZO_GPT_API_KEY", "sk-gpt")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    created = []

    class FakeOpenAI:
        def __init__(self, api_key=None, base_url=None):
            created.append(api_key)

    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    LLMAdapter()._get_client()
    assert created == ["sk-gpt"]


def test_the_platform_layer_sits_between_a_workspace_and_the_process(monkeypatch):
    """Three layers, most specific first. The middle one is what the operator configures
    once for everybody; without it their settings reached only their own workspace and
    everyone else fell through to whatever was in .env on the server."""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "from-dotenv")
    platform = current_platform_config.set({"DASHSCOPE_API_KEY": "from-platform"})
    try:
        assert workspace_getenv("DASHSCOPE_API_KEY") == "from-platform"
        workspace = current_workspace_config.set({"DASHSCOPE_API_KEY": "from-workspace"})
        try:
            assert workspace_getenv("DASHSCOPE_API_KEY") == "from-workspace"
        finally:
            current_workspace_config.reset(workspace)
    finally:
        current_platform_config.reset(platform)


def test_a_key_the_platform_layer_does_not_carry_falls_through(monkeypatch):
    """The platform layer is an override, not a replacement — same rule the workspace layer
    had to be taught after a single saved setting blanked every credential around it."""
    monkeypatch.setenv("OSS_BUCKET_NAME", "platform-bucket")
    token = current_platform_config.set({"OSS_ENDPOINT": "oss-cn-hangzhou.aliyuncs.com"})
    try:
        assert workspace_getenv("OSS_BUCKET_NAME") == "platform-bucket"
    finally:
        current_platform_config.reset(token)


def test_clearing_a_platform_setting_falls_back_rather_than_blanking(monkeypatch):
    """Removal is stored as a blank, and a blank counts as absent, so clearing a value in
    the console means "use .env again" instead of "configured as empty"."""
    monkeypatch.setenv("OSS_BASE_PATH", "from-dotenv")
    token = current_platform_config.set({"OSS_BASE_PATH": ""})
    try:
        assert workspace_getenv("OSS_BASE_PATH") == "from-dotenv"
    finally:
        current_platform_config.reset(token)


def test_with_no_platform_layer_resolution_is_unchanged(monkeypatch):
    """Desktop regression: a packaged build never writes the platform layer, and must keep
    resolving straight from its own environment and workspace config."""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "desktop-value")
    assert current_platform_config.get() is None
    assert workspace_getenv("DASHSCOPE_API_KEY") == "desktop-value"
    token = current_workspace_config.set({"DASHSCOPE_API_KEY": "workspace-value"})
    try:
        assert workspace_getenv("DASHSCOPE_API_KEY") == "workspace-value"
    finally:
        current_workspace_config.reset(token)


def test_readiness_agrees_with_what_a_call_would_actually_use(monkeypatch):
    """The regression this replaces: script analysis refused to run with "LLM API Key 未配置"
    on a platform where all three tiers answered. is_configured asked about OPENAI_API_KEY,
    which no tier uses once the keys are per-model, so the gate contradicted the call path
    standing right behind it."""
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.6-sol")
    monkeypatch.setenv("KAIZO_GPT_API_KEY", "sk-gpt")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    adapter = LLMAdapter()
    assert adapter.credential_for() == ("KAIZO_GPT_API_KEY", "sk-gpt")
    assert adapter.is_configured is True


def test_readiness_is_false_when_the_default_tiers_key_is_missing(monkeypatch):
    """The gate still has to close for real: a generic OPENAI_API_KEY lying around must not
    make a tier look usable when its own key is absent, because the call would be refused by
    the relay — that key cannot see this model."""
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_MODEL", "claude-opus-5")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-generic")
    monkeypatch.delenv("KAIZO_CLAUDE_API_KEY", raising=False)

    adapter = LLMAdapter()
    assert adapter.credential_for() == ("KAIZO_CLAUDE_API_KEY", None)
    assert adapter.is_configured is False


def test_a_model_outside_the_catalog_still_falls_back_to_the_generic_key(monkeypatch):
    """A custom endpoint configured by hand has no catalog entry and no per-model key."""
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_MODEL", "some-self-hosted-model")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-generic")

    adapter = LLMAdapter()
    assert adapter.credential_for() == ("OPENAI_API_KEY", "sk-generic")
    assert adapter.is_configured is True


def test_the_failure_message_names_the_variable_that_was_consulted(monkeypatch):
    """Naming OPENAI_API_KEY sent whoever read the error to set a variable nothing reads."""
    from src.apps.comic_gen.llm import ScriptProcessor

    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_MODEL", "claude-opus-5")
    processor = object.__new__(ScriptProcessor)
    processor.llm = LLMAdapter()
    assert processor._missing_llm_credential() == "KAIZO_CLAUDE_API_KEY"


def test_a_rate_limit_is_waited_out_rather_than_thrown_away(monkeypatch):
    """A 429 says "later", not "no". Nothing retried one, so a single rate limit anywhere in
    a long job — script analysis makes a call per chapter — discarded the whole run."""
    from src.apps.comic_gen import llm_adapter as module

    slept: list[float] = []
    monkeypatch.setattr(module.time, "sleep", lambda seconds: slept.append(seconds))
    attempts = {"n": 0}

    def flaky():
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise RuntimeError("Error code: 429 - too many requests")
        return "ok"

    assert module._with_rate_limit_retry(flaky, "gpt-5.6-sol") == "ok"
    assert attempts["n"] == 3
    assert slept == [2.0, 5.0], "short waits: someone is watching a progress bar"


def test_a_persistent_rate_limit_still_surfaces(monkeypatch):
    """Retrying for ever would turn a real capacity problem into a hang."""
    from src.apps.comic_gen import llm_adapter as module

    monkeypatch.setattr(module.time, "sleep", lambda _s: None)

    def always():
        raise RuntimeError("Error code: 429 - rate limit exceeded")

    with pytest.raises(RuntimeError, match="429"):
        module._with_rate_limit_retry(always, "gpt-5.6-sol")


def test_an_error_that_is_not_a_rate_limit_is_not_retried(monkeypatch):
    """Retrying an auth failure or a bad request just delays the report."""
    from src.apps.comic_gen import llm_adapter as module

    calls = {"n": 0}

    def broken():
        calls["n"] += 1
        raise RuntimeError("Error code: 401 - invalid api key")

    with pytest.raises(RuntimeError, match="invalid api key"):
        module._with_rate_limit_retry(broken, "gpt-5.6-sol")
    assert calls["n"] == 1


def test_the_upstreams_own_retry_after_wins_when_it_is_sensible(monkeypatch):
    from src.apps.comic_gen import llm_adapter as module

    slept: list[float] = []
    monkeypatch.setattr(module.time, "sleep", lambda seconds: slept.append(seconds))

    class Error(RuntimeError):
        response = SimpleNamespace(status_code=429, headers={"Retry-After": "7"})

    attempts = {"n": 0}

    def flaky():
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise Error("429")
        return "ok"

    assert module._with_rate_limit_retry(flaky, "m") == "ok"
    assert slept == [7.0]


def test_an_absurd_retry_after_is_ignored(monkeypatch):
    """A header asking for ten minutes must not become a silent ten-minute stall."""
    from src.apps.comic_gen import llm_adapter as module

    class Error(RuntimeError):
        response = SimpleNamespace(status_code=429, headers={"Retry-After": "600"})

    assert module._retry_after_seconds(Error("429")) is None
