from __future__ import annotations

from types import SimpleNamespace

import src.apps.comic_gen.api as api_module
from src.apps.comic_gen.llm_adapter import LLMAdapter


def test_update_env_config_refreshes_cached_llm_adapter(monkeypatch):
    previous_adapter = object()
    isolated_pipeline = SimpleNamespace(
        script_processor=SimpleNamespace(llm=previous_adapter),
    )
    saved_configs: list[dict[str, str]] = []

    monkeypatch.setattr(api_module, "pipeline", isolated_pipeline)
    monkeypatch.setattr(api_module, "save_user_config", lambda config: saved_configs.append(config.copy()))
    monkeypatch.setattr(api_module, "remove_user_config_keys", lambda keys: None)
    monkeypatch.setattr(api_module.OSSImageUploader, "reset_instance", lambda: None)
    monkeypatch.setenv("LLM_PROVIDER", "dashscope")

    response = api_module.update_env_config(
        api_module.EnvConfig(
            DASHSCOPE_API_KEY="sk-test-runtime-refresh",
            endpoint_overrides={
                "DASHSCOPE_BASE_URL": "https://workspace.example.com",
            },
        )
    )

    refreshed_adapter = isolated_pipeline.script_processor.llm
    assert response["status"] == "success"
    assert saved_configs == [
        {
            "DASHSCOPE_API_KEY": "sk-test-runtime-refresh",
            "DASHSCOPE_BASE_URL": "https://workspace.example.com",
        }
    ]
    assert isinstance(refreshed_adapter, LLMAdapter)
    assert refreshed_adapter is not previous_adapter
    assert refreshed_adapter.provider == "dashscope"
    assert refreshed_adapter._client is None


def test_update_env_config_keeps_llm_adapter_for_unrelated_changes(monkeypatch):
    previous_adapter = object()
    isolated_pipeline = SimpleNamespace(
        script_processor=SimpleNamespace(llm=previous_adapter),
    )

    monkeypatch.setattr(api_module, "pipeline", isolated_pipeline)
    monkeypatch.setattr(api_module, "save_user_config", lambda config: None)
    monkeypatch.setattr(api_module, "remove_user_config_keys", lambda keys: None)
    monkeypatch.setattr(api_module.OSSImageUploader, "reset_instance", lambda: None)

    response = api_module.update_env_config(
        api_module.EnvConfig(OSS_BASE_PATH="lumenx/test")
    )

    assert response["status"] == "success"
    assert isolated_pipeline.script_processor.llm is previous_adapter
