import ast
from pathlib import Path

from src.storage.db import resolve_default_db_path


def test_default_storage_keeps_an_existing_legacy_database(tmp_path: Path):
    legacy_path = tmp_path / "lumenx.db"
    legacy_path.touch()

    assert resolve_default_db_path(tmp_path) == legacy_path

    preferred_path = tmp_path / "omni_studio.db"
    preferred_path.touch()
    assert resolve_default_db_path(tmp_path) == preferred_path


def test_api_pipeline_uses_default_sqlite_storage_config():
    api_path = Path(__file__).parents[1] / "src" / "apps" / "comic_gen" / "api.py"
    module = ast.parse(api_path.read_text(encoding="utf-8"))

    pipeline_call = next(
        node.value
        for node in module.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "pipeline" for target in node.targets)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "ComicGenPipeline"
    )
    config_node = pipeline_call.args[0] if pipeline_call.args else next(
        keyword.value for keyword in pipeline_call.keywords if keyword.arg == "config"
    )

    storage_node = next(
        value
        for key, value in zip(config_node.keys, config_node.values)
        if ast.literal_eval(key) == "storage"
    )
    storage_config = {
        ast.literal_eval(key): value
        for key, value in zip(storage_node.keys, storage_node.values)
    }
    db_path_node = storage_config.pop("db_path")

    assert isinstance(db_path_node, ast.Call)
    assert isinstance(db_path_node.func, ast.Name) and db_path_node.func.id == "str"
    assert isinstance(db_path_node.args[0], ast.Name)
    assert db_path_node.args[0].id == "DEFAULT_DB_PATH"
    assert {key: ast.literal_eval(value) for key, value in storage_config.items()} == {
        "legacy_projects_path": "output/projects.json",
        "legacy_series_path": "output/series.json",
        "auto_migrate": True,
        "migration_mode": "apply",
    }
