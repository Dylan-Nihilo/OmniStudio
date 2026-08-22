from src.apps.comic_gen.api import build_script_export
from src.apps.comic_gen.models import Character, Scene, Script, StoryboardFrame


def make_script() -> Script:
    return Script(
        id="script-1",
        title="夜行者",
        original_text="林舟走进雨夜，发现一盏忽明忽暗的灯。",
        characters=[
            Character(id="character-1", name="林舟", description="沉默的侦探"),
            Character(id="character-2", name="阿宁", description="勇敢的搭档"),
        ],
        scenes=[
            Scene(id="scene-1", name="旧车站", description="雨夜的废弃车站"),
        ],
        created_at=0,
        updated_at=0,
        frames=[
            StoryboardFrame(
                id="frame-1",
                scene_id="scene-1",
                action_description="林舟推开生锈的车门。",
                speaker="林舟",
                dialogue="你也听见了吗？",
                duration=3,
            ),
            StoryboardFrame(
                id="frame-2",
                scene_id="scene-1",
                action_description="",
                character_acting="阿宁警觉地回头。",
                dialogue="听见了。",
                duration=2,
            ),
        ],
    )


def test_build_script_export_markdown_contains_script_structure():
    content = build_script_export(make_script(), "md")

    assert "# 夜行者" in content
    assert "## 场景：旧车站" in content
    assert "林舟、阿宁" in content
    assert "你也听见了吗？" in content
    assert "林舟推开生锈的车门。" in content
    assert "阿宁警觉地回头。" in content


def test_build_script_export_txt_contains_scene_and_speaker_dialogue():
    content = build_script_export(make_script(), "txt")

    assert "================\n夜行者\n================" in content
    assert "—— 场景：旧车站 ——" in content
    assert "角色：林舟、阿宁" in content
    assert "【林舟】：你也听见了吗？" in content
    assert "【对白】：听见了。" in content


def test_markdown_alias_matches_md_export():
    script = make_script()

    assert build_script_export(script, "markdown") == build_script_export(script, "md")

