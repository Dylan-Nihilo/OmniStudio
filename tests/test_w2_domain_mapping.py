import pytest

from src.apps.comic_gen.domain_mapping import (
    build_project_episodes,
    script_to_episode,
)
from src.apps.comic_gen.models import (
    Character,
    ProjectMode,
    Script,
    Series,
    StoryboardFrame,
    VideoTask,
)


def _make_script(script_id: str, **overrides) -> Script:
    values = {
        "id": script_id,
        "title": f"Episode {script_id}",
        "original_text": f"Story for {script_id}",
        "created_at": 100.0,
        "updated_at": 200.0,
    }
    values.update(overrides)
    return Script(**values)


def _make_series(series_id: str = "series-1", **overrides) -> Series:
    values = {
        "id": series_id,
        "title": "Shared universe",
        "created_at": 10.0,
        "updated_at": 20.0,
    }
    values.update(overrides)
    return Series(**values)


def test_build_standalone_project_with_one_episode() -> None:
    script = _make_script("script-1")

    project, episodes = build_project_episodes([script], None)

    assert project.id == script.id
    assert project.mode == ProjectMode.STANDALONE
    assert project.episode_ids == [script.id]
    assert project.characters == []
    assert project.scenes == []
    assert project.props == []
    assert len(episodes) == 1
    assert episodes[0].id == script.id
    assert episodes[0].project_id == project.id
    assert episodes[0].script.id == script.id


def test_build_series_project_promotes_shared_assets_and_preserves_episode_order() -> None:
    shared_character = Character(id="character-shared", name="Lin", description="Lead")
    series = _make_series(
        characters=[shared_character],
        episode_ids=["episode-2", "episode-1"],
        workflow_mode="r2v",
        content_mode="freeform",
    )
    scripts = [
        _make_script("episode-1", series_id=series.id, episode_number=1),
        _make_script("episode-2", series_id=series.id, episode_number=2),
    ]

    project, episodes = build_project_episodes(scripts, series)

    assert project.id == series.id
    assert project.mode == ProjectMode.SERIES
    assert project.episode_ids == ["episode-2", "episode-1"]
    assert [character.id for character in project.characters] == [shared_character.id]
    assert project.workflow_mode == series.workflow_mode
    assert project.content_mode == series.content_mode
    assert [episode.id for episode in episodes] == ["episode-1", "episode-2"]


def test_mapping_preserves_nested_ids_and_media_references() -> None:
    character = Character(
        id="character-1",
        name="Lin",
        description="Lead",
        image_url="/files/characters/lin.png",
    )
    frame = StoryboardFrame(
        id="frame-1",
        scene_id="scene-1",
        character_ids=[character.id],
        image_url="/files/storyboard/frame-1.png",
        video_url="https://media.example/frame-1.mp4",
    )
    video_task = VideoTask(
        id="video-task-1",
        project_id="episode-1",
        frame_id=frame.id,
        image_url=frame.image_url,
        prompt="Move slowly",
        video_url=frame.video_url,
    )
    script = _make_script(
        "episode-1",
        series_id="series-1",
        episode_number=1,
        characters=[character],
        frames=[frame],
        video_tasks=[video_task],
    )

    episode = script_to_episode(script)

    assert episode.id == script.id
    assert episode.script.characters[0].id == character.id
    assert episode.script.characters[0].image_url == character.image_url
    assert episode.script.frames[0].id == frame.id
    assert episode.script.frames[0].image_url == frame.image_url
    assert episode.script.frames[0].video_url == frame.video_url
    assert episode.script.video_tasks[0].id == video_task.id
    assert episode.script.video_tasks[0].frame_id == video_task.frame_id
    assert episode.script.video_tasks[0].video_url == video_task.video_url


def test_script_relationship_fields_move_to_episode_without_mutating_source() -> None:
    script = _make_script("episode-3", series_id="series-1", episode_number=3)

    episode = script_to_episode(script)

    assert episode.project_id == "series-1"
    assert episode.series_id == "series-1"
    assert episode.episode_number == 3
    assert episode.script.series_id is None
    assert episode.script.episode_number is None
    assert script.series_id == "series-1"
    assert script.episode_number == 3


def test_empty_series_builds_project_without_episodes() -> None:
    series = _make_series(episode_ids=[])

    project, episodes = build_project_episodes([], series)

    assert project.id == series.id
    assert project.mode == ProjectMode.SERIES
    assert project.episode_ids == []
    assert episodes == []


def test_empty_scripts_without_series_is_rejected() -> None:
    with pytest.raises(ValueError, match="at least one Script"):
        build_project_episodes([], None)


def test_series_scripts_without_confirmed_series_are_rejected() -> None:
    script = _make_script("episode-1", series_id="recovered-series", episode_number=1)

    with pytest.raises(ValueError, match="Series is required"):
        build_project_episodes([script], None)
