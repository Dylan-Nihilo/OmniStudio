import pytest

from src.apps.comic_gen.models import StoryboardFrame
from src.apps.comic_gen.prompt_assembly import enrich_prompt_with_dialogue
from src.apps.comic_gen.prompt_assembly import assemble_prompt
from src.apps.comic_gen.models import CameraMovementData, Script, Character
from src.apps.comic_gen.pipeline import ComicGenPipeline


@pytest.mark.parametrize("mode,characters,speaking", [
    ("on_screen", ["sue"], True),
    ("voiceover", ["sue"], False),
    ("on_screen", [], False),
])
def test_only_visible_spoken_dialogue_adds_lip_movement(mode, characters, speaking):
    frame = StoryboardFrame(id="frame", scene_id="room", character_ids=characters,
                            action_description="苏看着乔安画画", dialogue="这是他的杰作。",
                            speaker="苏", dialogue_mode=mode)
    result = enrich_prompt_with_dialogue("暖光落在两人身上", frame)
    assert ("张嘴说话" in result) is speaking
    if not speaking:
        assert result == "暖光落在两人身上"


def test_complete_prompt_does_not_append_old_camera_fields():
    frame = StoryboardFrame(id="frame", scene_id="room", prompt_mode="complete",
        visual_description="固定机位，全景，苏推开门。", shot_size="特写",
        camera_movement_structured=CameraMovementData(primary="push_in", speed="slow"))
    assert assemble_prompt(frame, []) == frame.visual_description


def test_complete_video_prompt_keeps_timed_dialogue_authoritative():
    frame = StoryboardFrame(id="frame", scene_id="bridge", character_ids=["sue"],
        prompt_mode="complete", dialogue="低头！", speaker="苏")
    prompt = "0-1秒苏说低头，1-4秒闭口下蹲。"
    assert enrich_prompt_with_dialogue(prompt, frame) == prompt


@pytest.mark.parametrize("mode,valid_audio,audio_mode", [("on_screen", True, "post"), ("voiceover", False, "post"), ("on_screen", False, "post"), ("on_screen", True, "driven")])
@pytest.mark.parametrize("prompt_mode", ["structured", "complete"])
def test_h3_keeps_the_requested_audio_mode_and_first_frame_contract(mode, valid_audio, audio_mode, prompt_mode):
    frame = StoryboardFrame(id="frame", scene_id="room", character_ids=["sue"], dialogue="明天会好的。",
        dialogue_mode=mode, prompt_mode=prompt_mode, audio_url="audio/line.mp3" if valid_audio else None)
    script = Script(id="script", title="test", original_text="test", created_at=0, updated_at=0, frames=[frame])
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.get_script = lambda _: script
    pipeline._save_data = lambda: None
    pipeline.resolve_episode_assets = lambda _: {"characters": [], "scenes": [], "props": []}
    def validate(*_):
        if not valid_audio:
            raise ValueError("stale audio")
    pipeline._validate_dub_audio = validate
    pipeline.create_video_task(script_id=script.id, image_url="", prompt="苏望向窗外", model="minimax/minimax-h3", frame_id=frame.id, audio_mode=audio_mode)
    task = script.video_tasks[-1]
    assert task.audio_mode == audio_mode
    assert task.audio_url == (frame.audio_url if audio_mode == "driven" else None)
    assert ("参考音频" in task.prompt) == (audio_mode == "driven" and prompt_mode == "structured")
    if prompt_mode == "complete":
        assert task.prompt == "苏望向窗外"
