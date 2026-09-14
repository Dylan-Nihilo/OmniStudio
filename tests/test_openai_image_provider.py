from __future__ import annotations

from unittest.mock import patch
import pytest

from src.models.mulerouter import (
    _get_openai_image_config,
    _extract_openai_image_url,
    _normalize_gpt_image_size,
    MuleRouterImageModel,
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


@pytest.mark.parametrize("size,expected", [("1024*576", "2048x1152"), ("576*1024", "1152x2048"), ("1024*768", "1024x768")])
def test_gpt_size_preserves_storyboard_aspect_ratio(size, expected):
    assert _normalize_gpt_image_size(size) == expected


@pytest.mark.parametrize("editing", [False, True])
def test_openai_image_generation_and_edit_send_high_quality(tmp_path, editing):
    ref = tmp_path / "ref.png"
    ref.write_bytes(b"reference")
    with patch("src.models.mulerouter._get_openai_image_config", return_value={"api_key": "test", "base_url": "https://image.example/v1", "model": "gpt-image-2"}), patch("src.models.mulerouter._request_with_retry") as request:
        request.return_value.json.return_value = {"data": [{"b64_json": "aGVsbG8="}]}
        MuleRouterImageModel({})._generate_via_openai_compatible("Static anime frame", str(tmp_path / "result.png"), size="1024*576", ref_image_paths=[str(ref)] if editing else [])
        body = request.call_args.kwargs["data" if editing else "json"]
        assert body["quality"] == "high"
        assert body["size"] == "2048x1152"


def test_storyboard_routes_gpt_image_to_the_selected_adapter(tmp_path, monkeypatch):
    from src.apps.comic_gen.storyboard import StoryboardGenerator
    from src.apps.comic_gen.models import StoryboardFrame
    monkeypatch.chdir(tmp_path)
    frame = StoryboardFrame(id="shot", scene_id="gate", action_description="A sword moves")
    with patch("src.apps.comic_gen.storyboard.WanxImageModel") as dashscope, patch("src.models.mulerouter.MuleRouterImageModel") as gpt, patch("src.utils.oss_utils.OSSImageUploader") as oss:
        oss.return_value.is_configured = False
        StoryboardGenerator().generate_frame(frame, [], None, prompt="Static anime frame", model_name="gpt-image-2")
        gpt.return_value.generate.assert_called_once()
        dashscope.return_value.generate.assert_not_called()
