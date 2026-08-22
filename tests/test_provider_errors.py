from types import SimpleNamespace

import pytest
import requests

from src.utils.provider_errors import (
    ProviderError,
    ProviderErrorCategory,
    classify_provider_error,
)


@pytest.mark.parametrize(
    ("exc", "category"),
    [
        (requests.exceptions.ConnectionError("connection refused"), ProviderErrorCategory.NETWORK),
        (pytest.param("httpx_timeout", ProviderErrorCategory.NETWORK, id="httpx-timeout")),
        (requests.exceptions.HTTPError("401", response=SimpleNamespace(status_code=401)), ProviderErrorCategory.AUTH),
        (requests.exceptions.HTTPError("403", response=SimpleNamespace(status_code=403)), ProviderErrorCategory.AUTH),
        (requests.exceptions.HTTPError("429", response=SimpleNamespace(status_code=429)), ProviderErrorCategory.QUOTA),
        (requests.exceptions.HTTPError("402", response=SimpleNamespace(status_code=402)), ProviderErrorCategory.QUOTA),
        (requests.exceptions.HTTPError("404", response=SimpleNamespace(status_code=404)), ProviderErrorCategory.MODEL_UNAVAILABLE),
        (
            requests.exceptions.HTTPError(
                "400 invalid parameter for model wan-test",
                response=SimpleNamespace(status_code=400),
            ),
            ProviderErrorCategory.MODEL_UNAVAILABLE,
        ),
        (RuntimeError("unexpected failure"), ProviderErrorCategory.UNKNOWN),
    ],
)
def test_classify_common_provider_errors(exc, category):
    if exc == "httpx_timeout":
        httpx = pytest.importorskip("httpx")
        exc = httpx.ReadTimeout("read timed out")

    classified = classify_provider_error(exc, provider="test-provider")

    assert isinstance(classified, ProviderError)
    assert classified.category is category
    assert classified.provider == "test-provider"


def test_provider_error_passes_through_unchanged():
    original = ProviderError(ProviderErrorCategory.AUTH, "dashscope", 502, "bad key")

    assert classify_provider_error(original, provider="other") is original


@pytest.mark.parametrize(
    ("category", "status_code"),
    [
        (ProviderErrorCategory.NETWORK, 503),
        (ProviderErrorCategory.AUTH, 502),
        (ProviderErrorCategory.QUOTA, 429),
        (ProviderErrorCategory.MODEL_UNAVAILABLE, 502),
        (ProviderErrorCategory.UNKNOWN, 500),
    ],
)
def test_status_code_mapping(category, status_code):
    error = classify_provider_error(RuntimeError(category.value), provider="provider")
    if category is not ProviderErrorCategory.UNKNOWN:
        error = ProviderError(category, "provider")

    assert error.status_code == status_code


@pytest.mark.parametrize(
    ("message", "category"),
    [
        ("Invalid API-key", ProviderErrorCategory.AUTH),
        ("Insufficient balance", ProviderErrorCategory.QUOTA),
        ("Model not exist", ProviderErrorCategory.MODEL_UNAVAILABLE),
    ],
)
def test_message_matching_is_case_insensitive(message, category):
    error = classify_provider_error(RuntimeError(message), provider="dashscope")

    assert error.category is category


def test_wanx_wraps_request_connection_error(monkeypatch):
    import src.models.wanx as wanx_module

    model = wanx_module.WanxModel.__new__(wanx_module.WanxModel)
    monkeypatch.setattr(
        wanx_module.requests,
        "post",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            requests.exceptions.ConnectionError("provider unavailable")
        ),
    )
    monkeypatch.setattr(wanx_module.time, "sleep", lambda _: None)

    with pytest.raises(ProviderError) as exc_info:
        model._generate_wan_r2v_http(
            prompt="test prompt",
            model_name="wan-test",
        )

    assert exc_info.value.category is ProviderErrorCategory.NETWORK
    assert exc_info.value.provider == "dashscope"
