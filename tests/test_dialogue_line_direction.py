"""Per-line direction, and refusing to synthesise a direction the voice will discard.

Two thirds of the voice catalogue is cosyvoice-v2, whose API has no instruction
parameter. Setting an emotion against one of those voices used to be accepted by the
workbench, logged as `instr=no` and thrown away, so a whole episode could be dubbed
"with emotion" and come back read flat with nothing saying why. On top of that a single
emotion covered a whole segment, and a segment is a conversation: 「耶！」 and 「唉…」 want
opposite readings.
"""
from types import SimpleNamespace

import pytest

from src.apps.comic_gen.audio import AudioGenerator, _compute_lines_hash
from src.apps.comic_gen.models import DialogueLine, StoryboardFrame
from src.apps.comic_gen.pipeline import (
    ComicGenPipeline, _refuse_unheard_direction, unheard_direction,
)
from src.audio.tts import TTSProcessor


def _plans(frame, script, *, carries=True, instructions=None, speed=1.0):
    """`_dialogue_line_plans` needs only a voice-capability check and a custom-voice lookup."""
    host = SimpleNamespace(
        audio_generator=SimpleNamespace(
            voice_carries_direction=lambda voice, override=None: carries),
        find_custom_voice=lambda voice, workspace: None,
    )
    return ComicGenPipeline._dialogue_line_plans(
        host, script, frame, None, None, speed, 1.0, 50, instructions)


def _script(**voices):
    characters = [SimpleNamespace(name=name, voice_id=voice, voice_speed=1.0,
                                 voice_pitch=1.0, voice_volume=50)
                  for name, voice in voices.items()]
    return SimpleNamespace(characters=characters, narration_voice_id=None)


def _frame(lines, duration=25):
    return StoryboardFrame(id="frame", scene_id="scene", duration=duration, dialogue_lines=lines)


def test_a_line_keeps_its_own_direction_and_pace_over_the_segments():
    """萧媚's 「耶！」 and her 「唉…」 three shots later cannot share one reading."""
    lines = [
        DialogueLine(speaker="萧媚", line="耶！", start_seconds=0.0,
                     instructions="情绪：欢呼；演绎：短促明亮，带笑", speed=1.1),
        DialogueLine(speaker="萧媚", line="唉…", start_seconds=12.0),
    ]
    plans = _plans(_frame(lines), _script(萧媚="Cherry"),
                   instructions="情绪：平稳", speed=1.0)

    assert plans[0]["instructions"] == "情绪：欢呼；演绎：短促明亮，带笑"
    assert plans[0]["speed"] == pytest.approx(1.1)
    # The line that wrote nothing of its own still takes the segment's setting.
    assert plans[1]["instructions"] == "情绪：平稳"
    assert plans[1]["speed"] == pytest.approx(1.0)


def test_editing_one_lines_direction_stales_the_track():
    """Otherwise the emotion is saved and the old flat reading is kept as current."""
    lines = [DialogueLine(speaker="萧炎", line="斗之力，三段！", start_seconds=0.0),
             DialogueLine(speaker="萧媚", line="耶！", start_seconds=12.0)]
    script = _script(萧炎="Moon", 萧媚="Cherry")
    before = _compute_lines_hash(_plans(_frame(lines), script))

    directed = [lines[0], lines[1].model_copy(update={"instructions": "情绪：欢呼"})]
    assert _compute_lines_hash(_plans(_frame(directed), script)) != before

    paced = [lines[0], lines[1].model_copy(update={"speed": 1.1})]
    assert _compute_lines_hash(_plans(_frame(paced), script)) != before


def test_only_the_speakers_whose_voice_cannot_act_on_direction_are_named():
    lines = [DialogueLine(speaker="萧炎", line="斗之力，三段！", start_seconds=0.0,
                          instructions="情绪：压抑"),
             DialogueLine(speaker="萧媚", line="耶！", start_seconds=12.0,
                          instructions="情绪：欢呼")]
    frame, script = _frame(lines), _script(萧炎="longnan_v2", 萧媚="Cherry")

    # 萧炎 is on a v2 voice; only his line's direction would vanish.
    plans = _plans(frame, script, carries=False)
    plans[1]["carries_direction"] = True
    assert unheard_direction(plans) == ["萧炎"]

    # A line with no direction written has nothing to lose, so it is not reported.
    undirected = _plans(_frame([lines[0].model_copy(update={"instructions": None})]),
                        script, carries=False)
    assert unheard_direction(undirected) == []


def test_the_refusal_says_which_speakers_and_where_to_change_it():
    """A bare failure would send the user looking in the wrong place — the fix is the voice."""
    lines = [DialogueLine(speaker="萧薰儿", line="谢谢。", start_seconds=0.0,
                          instructions="情绪：温柔")]
    plans = _plans(_frame(lines), _script(萧薰儿="longhua_v2"), carries=False)

    with pytest.raises(ValueError) as refusal:
        _refuse_unheard_direction(plans)
    message = str(refusal.value)
    assert "萧薰儿" in message
    assert "角色" in message and "支持情绪" in message
    # Nothing about models, vendors or parameter names leaks into the user's view.
    for leak in ("cosyvoice", "instruction", "qwen", "longhua"):
        assert leak not in message.lower()


def test_nothing_is_refused_when_every_voice_can_act_on_its_direction():
    lines = [DialogueLine(speaker="萧炎", line="斗之力，三段！", start_seconds=0.0,
                          instructions="情绪：压抑")]
    _refuse_unheard_direction(_plans(_frame(lines), _script(萧炎="Moon"), carries=True))


@pytest.mark.parametrize("voice,carries", [
    ("longnan_v2", False),      # cosyvoice-v2: the parameter does not exist
    ("longhua_v2", False),
    ("Moon", True),             # qwen3-tts
    ("Cherry", True),
])
def test_the_catalogue_reports_whether_a_voice_can_be_directed(voice, carries):
    """The five voices 斗破苍穹 was cast with were four v2 voices and one that could."""
    assert TTSProcessor(api_key="test-key").voice_supports_instruction(voice) is carries


def test_a_custom_voices_own_model_decides_whether_it_can_be_directed():
    """A clone or design is not in the catalogue, so the model it is bound to answers."""
    tts = TTSProcessor(api_key="test-key")
    assert not tts.voice_supports_instruction("my-clone", model_override="cosyvoice-v2")
    assert tts.voice_supports_instruction("my-clone", model_override="qwen3-tts-instruct-flash")


def test_without_tts_configured_no_voice_is_claimed_to_carry_direction():
    generator = AudioGenerator({})
    generator.tts = None
    assert generator.voice_carries_direction("Moon") is False
    assert generator.voice_carries_direction(None) is False
