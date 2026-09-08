from __future__ import annotations

from src.models.mulerouter import (
    _get_openai_image_config,
    _extract_openai_image_url,
)
from src.utils.workspace_env import current_workspace_config


def test_openai_image_config_is_read_from_workspace(monkeypatch):
    token = current_workspace_config.set(
        {
            "IMAGE_PROVIDER": "openai",
            "OPENAI_IMAGE_API_KEY": "kaizo-key",
            "OPENAI_IMAGE_BASE_URL": "https://api.kaizo.example/v1/",
            "OPENAI_IMAGE_MODEL": "gpt-image-2",
        }
    )
    try:
        assert _get_openai_image_config() == {
            "api_key": "kaizo-key",
            "base_url": "https://api.kaizo.example/v1",
            "model": "gpt-image-2",
        }
    finally:
        current_workspace_config.reset(token)


def test_openai_image_response_supports_url_and_base64_payloads():
    assert _extract_openai_image_url({"data": [{"url": "https://cdn.example/image.png"}]}) == (
        "https://cdn.example/image.png"
    )
    assert _extract_openai_image_url({"data": [{"b64_json": "aGVsbG8="}]}) == "data:image/png;base64,aGVsbG8="
