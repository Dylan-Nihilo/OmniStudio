from types import SimpleNamespace
from unittest.mock import create_autospec, patch

import dashscope
import pytest
from dashscope.audio.tts_v2 import SpeechSynthesizer

from src.apps.comic_gen.audio import AudioGenerator
from src.audio.tts import TTSProcessor
from src.billing import BillingError
from src.utils.workspace_env import current_workspace_config
from tests.test_billing_metering import env


@pytest.mark.parametrize("voice_id", ["longanlingxin", "qwen-audio-3.0-tts-plus-longyujunxuan", "qwen-audio-3.0-tts-plus-longlingzhixing"])
def test_qwen_audio_voice_uses_its_model_and_workspace_websocket(tmp_path, voice_id):
    factory = create_autospec(SpeechSynthesizer)
    factory.return_value.call.return_value = b"audio"
    factory.return_value.get_last_request_id.return_value = "request-1"
    factory.return_value.get_first_package_delay.return_value = 12
    original_url, original_key = dashscope.base_websocket_api_url, dashscope.api_key
    token = current_workspace_config.set({
        "DASHSCOPE_API_KEY": "workspace-key",
        "QWEN_AUDIO_TTS_BASE_URL": "wss://workspace.example/api-ws/v1/inference",
    })
    try:
        with patch("dashscope.audio.tts_v2.SpeechSynthesizer", factory):
            path = tmp_path / "preview.mp3"
            TTSProcessor().synthesize("它还在。", str(path), voice=voice_id, instructions="温柔，克制")
        kwargs = factory.call_args.kwargs
        assert kwargs["model"] == "qwen-audio-3.0-tts-plus"
        assert kwargs["voice"] == voice_id
        assert kwargs["url"] == "wss://workspace.example/api-ws/v1/inference"
        assert kwargs["instruction"] == "温柔，克制"
        assert path.read_bytes() == b"audio"
        voice = next(v for v in AudioGenerator().get_available_voices() if v["id"] == voice_id)
        assert voice["family"] == "qwen_audio" and voice["supports_instruction"]
        assert (dashscope.base_websocket_api_url, dashscope.api_key) == (original_url, original_key)
    finally:
        current_workspace_config.reset(token)


def test_unpriced_qwen_voice_is_rejected_before_synthesis(env, monkeypatch, tmp_path):
    from src.billing import BillingError
    from src.billing.metering import TextMeter, current_workspace_id

    services, _, _, wallet_id = env
    monkeypatch.setenv("OMNI_STUDIO_BILLING_ENABLED", "1")
    monkeypatch.setattr("src.audio.tts._text_meter", TextMeter(services, enabled=True))
    token = current_workspace_id.set("ws1")
    try:
        with patch.object(TTSProcessor, "_synthesize_cosyvoice") as synthesize:
            with pytest.raises(BillingError) as blocked:
                TTSProcessor().synthesize("不要在报价缺失时调用供应商", str(tmp_path / "voice.mp3"), voice="longanlingxin")
        assert blocked.value.code == "PRICING_ITEM_NOT_FOUND"
        synthesize.assert_not_called()
        assert services.wallets.balance(wallet_id) == {"balance": 1000, "frozen": 0, "available": 1000}
    finally:
        current_workspace_id.reset(token)


def test_qwen_audio_price_is_present_in_the_shipped_seed():
    import json
    from pathlib import Path

    seed = json.loads((Path(__file__).resolve().parents[1] / "config" / "pricing" / "price_book.seed.json").read_text(encoding="utf-8"))
    item = next(item for item in seed["items"] if item["model_id"] == "tts/qwen-audio-3.0-tts-plus")
    assert item["purchase_price_cny"] == 0.14
    assert item["billing_unit"] == "chars_1k"


def test_voice_preview_preserves_structured_billing_error(monkeypatch, tmp_path):
    """The picker must receive a pricing error instead of a misleading HTTP 500."""
    import src.apps.comic_gen.api as api_module

    class FailingTTS:
        def synthesize(self, **_kwargs):
            raise BillingError("PRICING_ITEM_NOT_FOUND", "没有 qwen-audio 的积分定价", status_code=422)

    request = SimpleNamespace(
        state=SimpleNamespace(
            auth_context=SimpleNamespace(workspace=SimpleNamespace(id="voice-preview-test")),
        ),
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(api_module.pipeline.audio_generator, "tts", FailingTTS())
    monkeypatch.setattr(api_module.pipeline, "find_custom_voice", lambda *_args: None)

    with pytest.raises(BillingError) as error:
        api_module.voice_preview(
            api_module.VoicePreviewRequest(voice_id="qwen-audio-3.0-tts-plus-longyujunxuan", text="试听"),
            request,
        )
    assert error.value.code == "PRICING_ITEM_NOT_FOUND"
    assert error.value.status_code == 422
