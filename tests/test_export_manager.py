from types import SimpleNamespace

import pytest

from src.apps.comic_gen.export import ExportManager
from src.apps.comic_gen.pipeline import ComicGenPipeline


def test_export_manager_delegates_to_durable_merge_callback(tmp_path):
    calls = []

    def render_callback(script, options):
        calls.append((script.id, options))
        return "video/merged.mp4"

    manager = ExportManager({"output_dir": str(tmp_path)}, render_callback=render_callback)
    script = SimpleNamespace(id="script-1")

    result = manager.render_project(script, {"resolution": "720p"})

    assert result == "video/merged.mp4"
    assert calls == [("script-1", {"resolution": "720p"})]


def test_export_manager_without_callback_fails_instead_of_creating_dummy_media(tmp_path):
    manager = ExportManager({"output_dir": str(tmp_path)})

    with pytest.raises(RuntimeError, match="merge callback"):
        manager.render_project(SimpleNamespace(id="script-1"), {})

    assert list(tmp_path.iterdir()) == []


def test_legacy_pipeline_export_maps_resolution_and_uses_merge(tmp_path):
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    script = SimpleNamespace(id="script-1", export_settings={})
    pipeline.scripts = {script.id: script}
    pipeline._save_data = lambda: None
    calls = []

    def fake_merge(script_id):
        calls.append(script_id)
        script.merged_video_url = "video/merged.mp4"
        return script

    pipeline.merge_videos = fake_merge

    result = pipeline._render_legacy_export(script, {"resolution": "720p", "subtitles": "soft"})

    assert result == "video/merged.mp4"
    assert calls == ["script-1"]
    assert script.export_settings == {"resolution": "1280x720", "subtitles": "soft"}
