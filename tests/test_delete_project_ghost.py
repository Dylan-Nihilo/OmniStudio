"""Regression: deleting a project must not leave ghost rows in SQLite."""
import json
import time

from sqlalchemy import create_engine, text

from src.apps.comic_gen.models import Script
from src.apps.comic_gen.pipeline import ComicGenPipeline


def _cfg(db_path, src_json, tmp_path):
    return {
        "storage": {
            "db_path": str(db_path),
            "legacy_projects_path": str(src_json),
            "legacy_series_path": str(tmp_path / "nonexistent.json"),
            "auto_migrate": True,
        }
    }


def test_delete_project_removes_sqlite_rows_and_survives_restart(tmp_path):
    db_path = tmp_path / "test.db"
    src_json = tmp_path / "projects.json"
    script = Script(
        id="ghost-test-3",
        title="幽灵测试",
        original_text="测试",
        created_at=time.time(),
        updated_at=time.time(),
    )
    src_json.write_text(json.dumps({script.id: script.model_dump(mode="json")}), encoding="utf-8")
    cfg = _cfg(db_path, src_json, tmp_path)

    p = ComicGenPipeline(config=cfg)
    assert "ghost-test-3" in p.scripts
    p.delete_project("ghost-test-3")
    assert "ghost-test-3" not in p.scripts

    # Restart: the project must NOT resurrect from stale SQLite rows.
    p2 = ComicGenPipeline(config=cfg)
    assert "ghost-test-3" not in p2.scripts

    engine = create_engine(f"sqlite:///{db_path}")
    with engine.connect() as c:
        for table in ("scripts", "episodes", "projects"):
            rows = c.execute(text(f"SELECT id FROM {table}")).fetchall()
            assert rows == [], f"ghost rows left in {table}: {rows}"
    engine.dispose()
