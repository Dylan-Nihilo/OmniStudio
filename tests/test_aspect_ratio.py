from src.apps.comic_gen.aspect_ratio import (
    effective_export_settings,
    export_resolutions_for_aspect_ratio,
    resolution_matches_aspect_ratio,
    resolve_video_task_aspect_ratio,
)


def test_export_resolutions_follow_ratio():
    assert export_resolutions_for_aspect_ratio("9:16")[0] == "1080x1920"
    assert export_resolutions_for_aspect_ratio("16:9")[0] == "1920x1080"
    assert export_resolutions_for_aspect_ratio("1:1")[0] == "1080x1080"


def test_stale_landscape_resolution_is_normalized_for_portrait_project():
    result = effective_export_settings({"resolution": "1920x1080", "crf": 20}, "9:16")
    assert result["resolution"] == "1080x1920"
    assert result["resolution_source"] == "aspect_ratio_default"


def test_custom_resolution_is_preserved_for_legacy_exports():
    result = effective_export_settings({"resolution": "160x120"}, "9:16")
    assert result["resolution"] == "160x120"


def test_resolution_matching_uses_reduced_ratio():
    assert resolution_matches_aspect_ratio("1080x1920", "9:16")
    assert not resolution_matches_aspect_ratio("1920x1080", "9:16")


def test_video_task_ratio_inherits_master_when_missing_or_invalid():
    assert resolve_video_task_aspect_ratio("16:9", "9:16") == "16:9"
    assert resolve_video_task_aspect_ratio(None, "1:1") == "1:1"
    assert resolve_video_task_aspect_ratio("9:16", "invalid") == "9:16"
    assert resolve_video_task_aspect_ratio("invalid", "9:16") == "9:16"
    assert resolve_video_task_aspect_ratio(None, "invalid") == "16:9"
