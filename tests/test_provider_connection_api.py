from __future__ import annotations

from unittest.mock import patch

import requests

from src.apps.comic_gen import api as api_module
from tests.test_w2_project_api import api_client


def test_provider_connection_test_reports_missing_credentials_without_network(api_client):
    response = api_client.post(
        "/config/provider-test",
        json={"provider": "dashscope", "model": "qwen-plus", "modality": "text"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["success"] is False
    assert payload["category"] == "auth"
    assert payload["credential_configured"] is False
    assert payload["latency_ms"] is None


def test_provider_connection_test_returns_latency_and_does_not_expose_key(api_client, monkeypatch):
    api_client.post("/config/env", json={"DASHSCOPE_API_KEY": "secret-provider-key"})
    monkeypatch.setattr(api_module, "requests", requests, raising=False)

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

    with patch.object(api_module.requests, "get", return_value=Response()) as get:
        response = api_client.post(
            "/config/provider-test",
            json={"provider": "dashscope", "model": "qwen-plus", "modality": "text"},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["success"] is True
    assert payload["category"] is None
    assert isinstance(payload["latency_ms"], int)
    assert payload["credential_configured"] is True
    assert "secret-provider-key" not in response.text
    get.assert_called_once()
    assert get.call_args.kwargs["timeout"] <= 10


def test_provider_connection_test_classifies_upstream_auth_failure(api_client, monkeypatch):
    api_client.post("/config/env", json={"DASHSCOPE_API_KEY": "secret-provider-key"})
    monkeypatch.setattr(api_module, "requests", requests, raising=False)

    class Response:
        status_code = 401

        def raise_for_status(self):
            import requests

            raise requests.HTTPError("invalid api key secret-provider-key", response=self)

    with patch.object(api_module.requests, "get", return_value=Response()):
        response = api_client.post(
            "/config/provider-test",
            json={"provider": "dashscope", "model": "qwen-plus", "modality": "text"},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["success"] is False
    assert payload["category"] == "auth"
    assert "secret-provider-key" not in response.text
    assert "api key" in payload["message"].lower()


def test_kling_dashscope_mode_only_requires_dashscope_key(api_client):
    api_client.post("/config/env", json={"DASHSCOPE_API_KEY": "secret-provider-key", "KLING_PROVIDER_MODE": "dashscope"})

    class Response:
        def raise_for_status(self):
            return None

    with patch.object(api_module.requests, "get", return_value=Response()) as get:
        response = api_client.post(
            "/config/provider-test",
            json={"provider": "kling", "model": "kling-v2", "modality": "video"},
        )

    assert response.status_code == 200, response.text
    assert response.json()["credential_configured"] is True
    get.assert_called_once()
