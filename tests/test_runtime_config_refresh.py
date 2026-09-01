from __future__ import annotations

import openai

from src.apps.comic_gen.api import _context_call, _context_iterator
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
