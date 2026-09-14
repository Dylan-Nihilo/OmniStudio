from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.llm_adapter import LLMAdapter
from src.utils.workspace_env import current_workspace_config


@pytest.mark.parametrize("finish_reason", ["stop", "length", None])
def test_llm_stream_requires_a_complete_response(finish_reason, monkeypatch):
    def chunk(content, reason=None):
        return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=content), finish_reason=reason)])

    usage_chunk = SimpleNamespace(choices=[], id="completion-1", usage=SimpleNamespace(prompt_tokens=7, completion_tokens=4))
    chunks = [chunk('{"status":'), SimpleNamespace(choices=[]), chunk('"ok"}', finish_reason), usage_chunk]
    charge = Mock()
    monkeypatch.setattr("src.apps.comic_gen.llm_adapter._charge_llm_usage", charge)
    create = Mock(return_value=nullcontext(iter(chunks)))
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    token = current_workspace_config.set({"LLM_PROVIDER": "openai"})
    try:
        if finish_reason == "stop":
            assert LLMAdapter()._chat_once(client, "gpt-5.6-sol", [], {"type": "json_object"}) == '{"status":"ok"}'
            charge.assert_called_once_with("gpt-5.6-sol", [], '{"status":"ok"}', usage_chunk)
        else:
            with pytest.raises(RuntimeError, match="Incomplete model response"):
                LLMAdapter()._chat_once(client, "gpt-5.6-sol", [], {"type": "json_object"})
        assert create.call_args.kwargs["stream"] is True
        assert create.call_args.kwargs["stream_options"] == {"include_usage": True}
        assert create.call_args.kwargs["response_format"] == {"type": "json_object"}
    finally:
        current_workspace_config.reset(token)
