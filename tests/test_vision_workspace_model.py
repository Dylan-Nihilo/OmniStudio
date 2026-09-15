from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

from src.apps.comic_gen.llm_adapter import LLMAdapter
from src.models.qwen_vl import QwenVLModel
from src.utils.workspace_env import current_workspace_config


def test_vision_uses_workspace_model_and_preserves_image_input(monkeypatch):
    result = SimpleNamespace(choices=[SimpleNamespace(
        delta=SimpleNamespace(content="Keep the sword in the right hand."), finish_reason="stop",
    )])
    create = Mock(return_value=nullcontext(iter([result])))
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    # The client is chosen per model now: each text tier carries its own relay key.
    monkeypatch.setattr(LLMAdapter, "_get_client", lambda self, model=None: client)
    token = current_workspace_config.set({"LLM_PROVIDER": "openai", "OPENAI_MODEL": "gpt-5.6-sol"})
    try:
        text, _ = QwenVLModel({}).optimize_prompt("https://example.com/frame.png", "Right hand holds one sword.")
        request = create.call_args.kwargs
        assert request["model"] == "gpt-5.6-sol"
        assert request["messages"][0]["content"][0]["image_url"]["url"] == "https://example.com/frame.png"
        assert "Right hand holds one sword." in request["messages"][0]["content"][1]["text"]
        assert text == "Keep the sword in the right hand."
    finally:
        current_workspace_config.reset(token)
