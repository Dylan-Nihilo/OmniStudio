from types import SimpleNamespace

from src.apps.comic_gen.pipeline import ComicGenPipeline


def _character(char_id: str, name: str):
    return SimpleNamespace(id=char_id, name=name)


def _frame(*, speaker=None, character_ids=None, structured_speaker=None):
    structured = (
        SimpleNamespace(speaker=structured_speaker)
        if structured_speaker is not None
        else None
    )
    return SimpleNamespace(
        speaker=speaker,
        dialogue_structured=structured,
        character_ids=character_ids or [],
    )


def test_explicit_speaker_wins_over_first_character_reference():
    lead = _character("lead", "胡轶飞（风衣）")
    waiter = _character("waiter", "服务生")
    script = SimpleNamespace(characters=[lead, waiter])
    frame = _frame(speaker="服务生", character_ids=["lead", "waiter"])

    assert ComicGenPipeline._resolve_dialogue_speaker(script, frame) is waiter


def test_speaker_name_fuzzy_matches_costume_variant():
    suit = _character("suit", "胡轶飞（西装）")
    script = SimpleNamespace(characters=[suit])
    frame = _frame(speaker="胡轶飞", character_ids=[])

    assert ComicGenPipeline._resolve_dialogue_speaker(script, frame) is suit


def test_first_character_is_legacy_fallback_without_speaker_name():
    first = _character("first", "杨大海")
    second = _character("second", "杨大江")
    script = SimpleNamespace(characters=[first, second])
    frame = _frame(character_ids=["second", "first"])

    assert ComicGenPipeline._resolve_dialogue_speaker(script, frame) is second
