import pytest
import threading

from src.apps.comic_gen.models import Script, StoryboardFrame, VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline


def _pipeline_with_selected_video(tmp_path):
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {}
    pipeline._save_data = lambda: None
    pipeline._save_lock = threading.RLock()
    script = Script(
        id="project-1",
        title="Assembly",
        original_text="text",
        frames=[StoryboardFrame(id="frame-1", scene_id="scene-1", action_description="Run", selected_video_id="video-1")],
        video_tasks=[VideoTask(id="video-1", project_id="project-1", frame_id="frame-1", image_url="image.png", prompt="run", duration=5)],
        created_at=0,
        updated_at=0,
    )
    pipeline.scripts[script.id] = script
    return pipeline


def test_frame_trim_is_persisted_without_mutating_video_task(tmp_path):
    pipeline = _pipeline_with_selected_video(tmp_path)
    script = pipeline.update_frame("project-1", "frame-1", in_point=1.25, out_point=4.5)

    assert script.frames[0].in_point == 1.25
    assert script.frames[0].out_point == 4.5
    assert script.video_tasks[0].duration == 5


@pytest.mark.parametrize("in_point,out_point", [(3, 2), (0, 6)])
def test_frame_trim_rejects_invalid_ranges(tmp_path, in_point, out_point):
    pipeline = _pipeline_with_selected_video(tmp_path)
    with pytest.raises(ValueError):
        pipeline.update_frame("project-1", "frame-1", in_point=in_point, out_point=out_point)


def test_split_frame_creates_ordered_non_destructive_segments(tmp_path):
    pipeline = _pipeline_with_selected_video(tmp_path)
    updated = pipeline.split_assembly_frame("project-1", "frame-1", 2.0)

    assert [frame.id for frame in updated.frames][0] == "frame-1"
    assert updated.frames[0].in_point == 0
    assert updated.frames[0].out_point == 2
    assert updated.frames[1].in_point == 2
    assert updated.frames[1].out_point == 5
    assert updated.frames[1].selected_video_id == "video-1"
