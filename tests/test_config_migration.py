from __future__ import annotations

import json
from pathlib import Path

from src.apps.comic_gen.auth.settings import migrate_config_file


def test_legacy_auth_config_is_migrated_with_backup_and_history(tmp_path: Path):
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps(
            {
                "auth_signing_secret": "legacy-signing-secret",
                "theme": "dark",
            }
        ),
        encoding="utf-8",
    )

    result = migrate_config_file(config_path)

    assert result.migrated is True
    migrated = json.loads(config_path.read_text(encoding="utf-8"))
    assert migrated["config_version"] == 2
    assert migrated["auth"]["signing_secret"] == "legacy-signing-secret"
    assert "auth_signing_secret" not in migrated
    assert migrated["theme"] == "dark"
    assert migrated["migration_history"][0]["from_version"] == 1
    assert migrated["migration_history"][0]["to_version"] == 2
    assert result.backup_path and Path(result.backup_path).is_file()
    assert json.loads(Path(result.backup_path).read_text(encoding="utf-8"))["auth_signing_secret"] == "legacy-signing-secret"


def test_current_config_migration_is_idempotent(tmp_path: Path):
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps(
            {
                "config_version": 2,
                "auth": {"signing_secret": "current-secret"},
                "migration_history": [],
            }
        ),
        encoding="utf-8",
    )

    result = migrate_config_file(config_path)

    assert result.migrated is False
    assert result.backup_path is None
