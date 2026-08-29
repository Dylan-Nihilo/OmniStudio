"""Pure W2 mappings from legacy Script/Series containers to Project/Episode."""

from typing import List, Optional, Tuple

from .models import Episode, Project, ProjectMode, Script, Series


def script_to_episode(script: Script) -> Episode:
    """Move a legacy Script's relationship fields onto an Episode wrapper.

    The embedded Script remains the complete production payload, except that
    ``series_id`` and ``episode_number`` are cleared because those are Episode
    relationships in the W2 model. The source Script is not mutated.
    """

    series_id = script.series_id
    episode_number = script.episode_number
    episode_script = script.model_copy(
        deep=True,
        update={"series_id": None, "episode_number": None},
    )
    return Episode(
        id=script.id,
        project_id=series_id or script.id,
        series_id=series_id,
        episode_number=episode_number,
        script=episode_script,
        created_at=script.created_at,
        updated_at=script.updated_at,
    )


def series_to_project(series: Series) -> Project:
    """Promote legacy Series shared assets and defaults into a Project."""

    return Project(
        id=series.id,
        title=series.title,
        mode=ProjectMode.SERIES,
        characters=[item.model_copy(deep=True) for item in series.characters],
        scenes=[item.model_copy(deep=True) for item in series.scenes],
        props=[item.model_copy(deep=True) for item in series.props],
        art_direction=(
            series.art_direction.model_copy(deep=True) if series.art_direction is not None else None
        ),
        prompt_config=series.prompt_config.model_copy(deep=True),
        model_settings=series.model_settings.model_copy(deep=True),
        workflow_mode=series.workflow_mode,
        default_generation_mode=series.default_generation_mode,
        custom_voices=[item.model_copy(deep=True) for item in series.custom_voices],
        content_mode=series.content_mode,
        episode_ids=list(series.episode_ids),
        created_at=series.created_at,
        updated_at=series.updated_at,
    )


def build_project_episodes(
    scripts: List[Script],
    series: Optional[Series],
    *,
    project_id: Optional[str] = None,
) -> Tuple[Project, List[Episode]]:
    """Build a W2 Project and its Episodes without storage or file access.

    A standalone Project requires at least one Script so its legacy-compatible
    ID and title are known. Callers may override that Project ID explicitly.
    Series-linked Scripts require the corresponding Series object, so this
    function never synthesizes shared project metadata on its own.
    """

    if series is None:
        if not scripts:
            raise ValueError("Standalone mapping requires at least one Script")
        if any(script.series_id is not None for script in scripts):
            raise ValueError("Series is required for Scripts with a series_id")

        first_script = scripts[0]
        resolved_project_id = project_id or first_script.id
        episodes = [
            script_to_episode(script).model_copy(update={"project_id": resolved_project_id})
            for script in scripts
        ]
        project = Project(
            id=resolved_project_id,
            title=first_script.title,
            mode=ProjectMode.STANDALONE,
            episode_ids=[script.id for script in scripts],
            created_at=first_script.created_at,
            updated_at=first_script.updated_at,
        )
        return project, episodes

    if project_id is not None and project_id != series.id:
        raise ValueError("A series Project ID must match Series.id")
    if any(script.series_id != series.id for script in scripts):
        raise ValueError("Every Script must reference the supplied Series.id")

    project = series_to_project(series)
    episodes = [script_to_episode(script) for script in scripts]
    return project, episodes
