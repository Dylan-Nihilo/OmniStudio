import ast
from pathlib import Path


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

    assert ast.literal_eval(config_node) == {
        "storage": {
            "db_path": "output/omni_studio.db",
            "legacy_projects_path": "output/projects.json",
            "legacy_series_path": "output/series.json",
            "auto_migrate": True,
            "migration_mode": "apply",
        }
    }
