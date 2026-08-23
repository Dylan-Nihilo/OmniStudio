from pathlib import Path
import json
import time

import pytest

from src.apps.comic_gen.models import Script, Series
from src.apps.comic_gen.pipeline import ComicGenPipeline


def _script(script_id: str = "script-1", title: str = "初始标题") -> Script:
    now = time.time()
    return Script(
        id=script_id,
        title=title,
        original_text="一段原始文本",
        created_at=now,
        updated_at=now,
    )


def _write_legacy_projects(path: Path, script: Script) -> None:
    path.write_text(
        json.dumps({script.id: script.model_dump(mode="json")}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@pytest.fixture
def quiet_pipeline(monkeypatch):
    monkeypatch.setattr(ComicGenPipeline, "_warmup_demucs_model", lambda self: None)


def _storage_config(db_path: Path, projects_path: Path, series_path: Path) -> dict:
    return {
        "storage": {
            "db_path": str(db_path),
            "legacy_projects_path": str(projects_path),
            "legacy_series_path": str(series_path),
            "auto_migrate": True,
        }
    }


def test_pipeline_storage_migrates_and_round_trips_without_writing_json(
    tmp_path: Path, quiet_pipeline
):
    db_path = tmp_path / "lumenx.db"
    projects_path = tmp_path / "projects.json"
    series_path = tmp_path / "series.json"
    original = _script()
    _write_legacy_projects(projects_path, original)
    projects_mtime = projects_path.stat().st_mtime_ns

    pipeline = ComicGenPipeline(config=_storage_config(db_path, projects_path, series_path))

    assert pipeline.storage_enabled is True
    assert pipeline.data_file == str(projects_path)
    assert pipeline.series_data_file == str(series_path)
    assert pipeline.scripts[original.id].title == "初始标题"

    pipeline.scripts[original.id].title = "修改后的标题"
    pipeline._save_data()

    assert projects_path.stat().st_mtime_ns == projects_mtime

    restarted = ComicGenPipeline(config=_storage_config(db_path, projects_path, series_path))
    assert restarted.scripts[original.id].title == "修改后的标题"


def test_pipeline_storage_write_through_for_create_project(tmp_path: Path, quiet_pipeline, monkeypatch):
    db_path = tmp_path / "lumenx.db"
    projects_path = tmp_path / "projects.json"
    series_path = tmp_path / "series.json"
    config = _storage_config(db_path, projects_path, series_path)
    created = _script("created-script", "通过 Pipeline 创建")

    pipeline = ComicGenPipeline(config=config)
    monkeypatch.setattr(
        pipeline.script_processor,
        "create_draft_script",
        lambda title, text: created,
    )

    result = pipeline.create_project("通过 Pipeline 创建", "草稿文本", skip_analysis=True)

    assert result.id in pipeline.scripts
    restarted = ComicGenPipeline(config=config)
    assert restarted.scripts[created.id].title == "通过 Pipeline 创建"


def test_pipeline_without_storage_keeps_json_write_behavior(tmp_path: Path, quiet_pipeline):
    projects_path = tmp_path / "projects.json"
    pipeline = ComicGenPipeline()
    script = _script()
    pipeline.data_file = str(projects_path)
    pipeline.scripts = {script.id: script}

    assert pipeline.storage_enabled is False
    pipeline._save_data()

    assert projects_path.is_file()
    saved = json.loads(projects_path.read_text(encoding="utf-8"))
    assert saved[script.id]["title"] == script.title


def test_pipeline_storage_series_round_trip(tmp_path: Path, quiet_pipeline):
    db_path = tmp_path / "lumenx.db"
    projects_path = tmp_path / "projects.json"
    series_path = tmp_path / "series.json"
    config = _storage_config(db_path, projects_path, series_path)
    pipeline = ComicGenPipeline(config=config)

    now = time.time()
    series = Series(id="series-1", title="系列一", created_at=now, updated_at=now)
    pipeline.series_store[series.id] = series
    pipeline._save_series_data()

    restarted = ComicGenPipeline(config=config)
    assert restarted.series_store[series.id].title == "系列一"
