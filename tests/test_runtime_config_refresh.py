from __future__ import annotations

import openai

from src.apps.comic_gen.api import (
    SECRET_FIELDS,
    EnvConfig,
    _context_call,
    _context_iterator,
    _mask_secret,
)
from src.apps.comic_gen.llm_adapter import LLMAdapter
from src.utils.workspace_env import current_workspace_config, workspace_getenv


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
