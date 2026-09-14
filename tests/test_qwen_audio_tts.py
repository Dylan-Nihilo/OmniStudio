from unittest.mock import create_autospec, patch

import dashscope
import pytest
from dashscope.audio.tts_v2 import SpeechSynthesizer

from src.apps.comic_gen.audio import AudioGenerator
from src.audio.tts import TTSProcessor
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
