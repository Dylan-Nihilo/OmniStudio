"""Designed voices must retain their model when bound to a standalone character."""
import pytest
from src.audio.tts import TTSProcessor


@pytest.mark.parametrize('voice,target',[
    ('cosyvoice-v3.5-plus-vd-design-example','cosyvoice-v3.5-plus'),
    ('cosyvoice-v3.5-flash-vd-neonecho-example','cosyvoice-v3.5-flash'),
    ('cosyvoice-v3-flash-custom-example','cosyvoice-v3-flash'),
    ('cosyvoice-v2-custom-example','cosyvoice-v2'),
])
def test_designed_voice_model_survives_without_series_lookup(voice,target):
    tts=TTSProcessor(api_key='test-key',model='cosyvoice-v3-flash')
    assert tts._resolve_model_for_voice(voice)==target


def test_unknown_voice_keeps_configured_default():
    tts=TTSProcessor(api_key='test-key',model='cosyvoice-v3-flash')
    assert tts._resolve_model_for_voice('unrelated-voice')=='cosyvoice-v3-flash'
    assert tts._resolve_model_for_voice('Vivian')=='qwen3-tts-flash'


def test_designed_v2_does_not_inherit_v3_instruction_support():
    tts=TTSProcessor(api_key='test-key',model='cosyvoice-v3-flash')
    assert not tts._voice_supports_instruction('cosyvoice-v2-custom-example')
    assert tts._voice_supports_instruction('cosyvoice-v3.5-plus-vd-example')


@pytest.mark.parametrize('voice', ['longanyang', 'longanhuan'])
def test_cosyvoice_v3_system_voices_reject_instruction_field(voice):
    """The provider currently returns engine 428 when these voices receive it."""
    tts = TTSProcessor(api_key='test-key', model='cosyvoice-v3-flash')
    assert not tts._voice_supports_instruction(voice)


def test_model_prefix_requires_delimiter():
    tts=TTSProcessor(api_key='test-key',model='cosyvoice-v3-flash')
    assert tts._resolve_model_for_voice('cosyvoice-v2unknown')=='cosyvoice-v3-flash'
