from types import SimpleNamespace

import pytest

from src.apps.comic_gen.models import GenerationStatus
from src.apps.comic_gen.pipeline import ComicGenPipeline


@pytest.fixture
def pipeline():
    instance = ComicGenPipeline.__new__(ComicGenPipeline)
    instance.scripts = {}
    instance._save_data = lambda: None
    return instance


def _frame(*, pinned=False, locked=False):
    return SimpleNamespace(
        id="frame-1",
        selected_video_id="video-existing",
        video_url="video/existing.mp4",
        is_video_pinned=pinned,
        locked=locked,
    )


def _video_task(
    task_id,
    *,
    created_at,
    status=GenerationStatus.COMPLETED,
    video_url=None,
):
    return SimpleNamespace(
        id=task_id,
        frame_id="frame-1",
        status=status,
        video_url=video_url or f"video/{task_id}.mp4",
        created_at=created_at,
    )


def _script(frame, video_tasks):
    return SimpleNamespace(
        id="script-1",
        frames=[frame],
        video_tasks=video_tasks,
    )


def test_auto_select_latest_video_selects_latest_completed_task(pipeline):
    frame = _frame()
    script = _script(
        frame,
        [
            _video_task("video-older", created_at=100),
            _video_task("video-newer", created_at=200),
            _video_task(
                "video-newest-pending",
                created_at=300,
                status=GenerationStatus.PROCESSING,
            ),
        ],
    )
    pipeline.scripts[script.id] = script

    pipeline.auto_select_latest_video(script.id, frame.id)

    assert frame.selected_video_id == "video-newer"
    assert frame.video_url == "video/video-newer.mp4"
    assert frame.is_video_pinned is False


def test_auto_select_latest_video_does_not_modify_pinned_frame(pipeline):
    frame = _frame(pinned=True)
    script = _script(frame, [_video_task("video-new", created_at=200)])
    pipeline.scripts[script.id] = script

    pipeline.auto_select_latest_video(script.id, frame.id)

    assert frame.selected_video_id == "video-existing"
    assert frame.video_url == "video/existing.mp4"


def test_auto_select_latest_video_does_not_modify_locked_frame(pipeline):
    frame = _frame(locked=True)
    script = _script(frame, [_video_task("video-new", created_at=200)])
    pipeline.scripts[script.id] = script

    pipeline.auto_select_latest_video(script.id, frame.id)

    assert frame.selected_video_id == "video-existing"
    assert frame.video_url == "video/existing.mp4"


def test_auto_select_latest_video_does_not_modify_locked_and_pinned_frame(pipeline):
    frame = _frame(pinned=True, locked=True)
    script = _script(frame, [_video_task("video-new", created_at=200)])
    pipeline.scripts[script.id] = script

    pipeline.auto_select_latest_video(script.id, frame.id)

    assert frame.selected_video_id == "video-existing"
    assert frame.video_url == "video/existing.mp4"


def test_auto_select_latest_video_does_not_modify_when_no_task_completed(pipeline):
    frame = _frame()
    script = _script(
        frame,
        [
            _video_task(
                "video-processing",
                created_at=200,
                status=GenerationStatus.PROCESSING,
            ),
            _video_task(
                "video-failed",
                created_at=300,
                status=GenerationStatus.FAILED,
            ),
        ],
    )
    pipeline.scripts[script.id] = script

    pipeline.auto_select_latest_video(script.id, frame.id)

    assert frame.selected_video_id == "video-existing"
    assert frame.video_url == "video/existing.mp4"


def test_select_video_for_frame_pins_selection_and_syncs_video_url(pipeline):
    frame = _frame()
    selected = _video_task("video-selected", created_at=200)
    script = _script(frame, [selected])
    pipeline.scripts[script.id] = script

    pipeline.select_video_for_frame(script.id, frame.id, selected.id)

    assert frame.selected_video_id == selected.id
    assert frame.video_url == selected.video_url
    assert frame.is_video_pinned is True


def test_unpin_video_clears_pin_but_preserves_selection(pipeline):
    frame = _frame(pinned=True)
    script = _script(frame, [])
    pipeline.scripts[script.id] = script

    pipeline.unpin_video(script.id, frame.id)

    assert frame.is_video_pinned is False
    assert frame.selected_video_id == "video-existing"
    assert frame.video_url == "video/existing.mp4"
