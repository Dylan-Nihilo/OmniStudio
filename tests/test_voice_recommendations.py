from __future__ import annotations

from unittest.mock import patch

from src.apps.comic_gen import api as api_module
from tests.test_w2_project_api import api_client


def test_voice_recommendation_returns_ranked_reasons_without_binding(api_client):
    voices = [
        {"id": "female-a", "name": "Female A", "gender": "Female", "family": "cosyvoice", "supports_instruction": True, "dialect": None, "lang_primary": None, "origin": "system"},
        {"id": "male-a", "name": "Male A", "gender": "Male", "family": "qwen3", "supports_instruction": False, "dialect": "beijing", "lang_primary": None, "origin": "system"},
    ]
    with patch.object(api_module.pipeline.audio_generator, "get_available_voices", return_value=voices):
        response = api_client.post(
            "/voices/recommend",
            json={"character_gender": "Female", "character_description": "冷静的侦探", "preview_text": "请跟我来。"},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["recommendations"][0]["voice_id"] == "female-a"
    assert payload["recommendations"][0]["reasons"]
    assert payload["recommendations"][0]["score"] > payload["recommendations"][1]["score"]
    assert "bound" not in payload
