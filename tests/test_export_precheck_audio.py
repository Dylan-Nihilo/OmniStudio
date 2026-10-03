"""Dubbing must not invalidate a video take that it could not have changed."""
import pytest

from src.apps.comic_gen import api as api_module
from src.apps.comic_gen.models import Character, Scene, StoryboardFrame, VideoTask
from tests.test_w2_project_api import api_client, _create_project  # noqa: F401


def _episode(client, *, audio_mode="post", production_plan_id="plan"):
    """One shot with a completed take, recorded the way create_video_task records it."""
    project = _create_project(client, "导出预检")
    script = api_module.pipeline.scripts[project["id"]]
    script.characters = [Character(id="lu", name="陆青", description="少年剑客")]
    script.scenes = [Scene(id="pavilion", name="雨夜破亭", description="破亭檐下")]
    script.frames = [StoryboardFrame(id="frame", scene_id="pavilion", character_ids=["lu"],
                                     action_description="对峙", visual_description="陆青挡住亭口。对白 陆青：为何不答？",
                                     duration=8, production_plan_id=production_plan_id,
                                     video_url="video/take.mp4", selected_video_id="take")]
    pipeline = api_module.pipeline
    frame = script.frames[0]
    script.video_tasks = [VideoTask(
        id="take", project_id=script.id, frame_id="frame", image_url="", prompt="提示词",
        status="completed", video_url="video/take.mp4", audio_mode=audio_mode,
        input_fingerprint=pipeline._shot_input_fingerprint(script, frame),
        visual_input_fingerprint=pipeline._shot_input_fingerprint(script, frame, audio_inputs=False),
    )]
    pipeline._save_data()
    return project["id"], script


def _issues(project_id):
    report = api_module.pipeline.precheck_merge(project_id)
    return report.get("content_issues") or []


def test_assigning_a_voice_after_generating_does_not_invalidate_the_take(api_client):
    """The intended order is: make the videos, assign voices, dub, export.

    Doing it refused its own output — the fingerprint counted every character's voice
    settings, which never reach a model that is not audio-driven. Observed on 斗破苍穹:
    all eight takes were blocked with nothing visual changed.
    """
    project_id, script = _episode(api_client)
    assert not _issues(project_id), "a freshly recorded take is not an issue"

    script.characters[0].voice_id = "longnan_v2"
    script.characters[0].voice_speed = 1.2
    api_module.pipeline._save_data()
    assert not _issues(project_id), "assigning a voice cannot have changed the picture"


def test_dubbing_and_dialogue_do_not_invalidate_a_plan_take(api_client):
    project_id, script = _episode(api_client)
    frame = script.frames[0]
    frame.audio_url = "audio/dialogue/track.mp3"
    frame.dialogue = "为何不答？"
    frame.dialogue_instructions = "情绪：质问"
    api_module.pipeline._save_data()
    issues = _issues(project_id)
    assert not any(issue.get("reviewable") for issue in issues), "后期对白不能使画面过期"
    assert any("配音" in issue["reason"] for issue in issues), "未应用的配音需要确认"


def test_a_real_picture_change_still_blocks_the_export(api_client):
    project_id, script = _episode(api_client)
    script.frames[0].visual_description = "换成完全不同的画面描述"
    api_module.pipeline._save_data()
    issues = _issues(project_id)
    assert issues and issues[0]["blocking"] is True
    assert issues[0]["reviewable"] is True, "还得能人工保留"


def test_an_audio_driven_take_still_notices_a_voice_change(api_client):
    """There the voice does reach the model, so it does change the result."""
    project_id, script = _episode(api_client, audio_mode="driven")
    assert not _issues(project_id)

    script.characters[0].voice_id = "longnan_v2"
    api_module.pipeline._save_data()
    assert _issues(project_id), "音频驱动时改音色确实会改变成片"


def test_an_old_take_is_given_a_picture_fingerprint_only_when_that_is_provable(api_client):
    project_id, script = _episode(api_client)
    task = script.video_tasks[0]
    recorded = task.input_fingerprint
    task.visual_input_fingerprint = None            # a take from before the split
    script.characters[0].voice_id = "longnan_v2"    # voices assigned afterwards
    api_module.pipeline._save_data()

    api_module.pipeline._backfill_visual_fingerprints()
    task = api_module.pipeline.scripts[project_id].video_tasks[0]
    assert task.visual_input_fingerprint, "画面侧可证明未变，应补上"
    assert task.input_fingerprint == recorded, "不该改动原有指纹"
    assert not _issues(project_id)

    # Idempotent.
    api_module.pipeline._backfill_visual_fingerprints()
    assert api_module.pipeline.scripts[project_id].video_tasks[0].visual_input_fingerprint == task.visual_input_fingerprint


def test_an_old_take_whose_picture_moved_is_not_waved_through(api_client):
    project_id, script = _episode(api_client)
    script.video_tasks[0].visual_input_fingerprint = None
    script.frames[0].visual_description = "画面描述被改过了"
    api_module.pipeline._save_data()

    api_module.pipeline._backfill_visual_fingerprints()
    task = api_module.pipeline.scripts[project_id].video_tasks[0]
    assert task.visual_input_fingerprint is None, "画面可能变过，不该自动放行"
    assert _issues(project_id)
