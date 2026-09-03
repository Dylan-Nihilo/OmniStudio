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


def test_workspace_config_does_not_fall_back_to_process_secrets(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "process-secret")
    assert workspace_getenv("DASHSCOPE_API_KEY") == "process-secret"

    token = current_workspace_config.set({})
    try:
        assert workspace_getenv("DASHSCOPE_API_KEY") is None
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
