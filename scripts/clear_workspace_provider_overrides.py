"""Clear provider credentials out of the per-workspace override layer.

Why this exists: the default workspace used to inherit a copy of .env on first access, so
production ended up with several workspaces each holding their own copy of the platform's
DashScope key and OSS settings. Those copies are workspace overrides, which now outrank the
platform layer — so rotating a credential in the root console would leave every one of them
still using the stale copy. That is the same class of bug that had production reading an
empty OSS bucket while the value sat in .env all along.

A copy is only safe to drop when it matches the value the workspace would resolve without
it, so the report says so per key and `--apply` refuses to touch anything that differs
unless you pass --force. Only keys on the provider allowlist are considered; anything else
in the row is left alone.

    python scripts/clear_workspace_provider_overrides.py               # report only
    python scripts/clear_workspace_provider_overrides.py --apply
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from src.apps.comic_gen.api import _WORKSPACE_PROVIDER_CONFIG_KEYS
from src.storage.auth_repository import AuthRepository
from src.storage.db import create_engine
from src.storage.schema import WorkspaceProviderConfig


def _digest(value: str | None) -> str:
    """Secrets must not reach a terminal or a log, but they still have to be compared."""
    return hashlib.sha256((value or "").encode()).hexdigest()[:10]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.getenv("OMNI_STUDIO_DATABASE_URL"),
                        help="defaults to $OMNI_STUDIO_DATABASE_URL, else the local SQLite file")
    parser.add_argument("--apply", action="store_true", help="write the changes")
    parser.add_argument("--force", action="store_true",
                        help="also clear copies whose value differs from the layer below")
    args = parser.parse_args()

    engine = create_engine(args.database_url) if args.database_url else create_engine()
    repository = AuthRepository(engine)
    platform = repository.get_platform_provider_config()

    def underlying(key: str) -> str | None:
        """What the workspace would resolve for this key once its own copy is gone."""
        value = platform.get(key)
        return value if value not in (None, "") else os.getenv(key)

    with engine.connect() as connection:
        rows = list(connection.execute(
            select(WorkspaceProviderConfig.workspace_id, WorkspaceProviderConfig.config_json)
        ))

    total_cleared = 0
    total_differing = 0
    for workspace_id, raw in rows:
        config = json.loads(raw)
        candidates = {key: value for key, value in config.items()
                      if key in _WORKSPACE_PROVIDER_CONFIG_KEYS and value not in (None, "")}
        if not candidates:
            continue
        print(f"\nworkspace {workspace_id}")
        clearable: list[str] = []
        for key, value in sorted(candidates.items()):
            below = underlying(key)
            same = _digest(value) == _digest(below)
            print(f"  {key:34} {_digest(value)} "
                  f"{'== 下层一致' if same else f'!= 下层 {_digest(below)}'}")
            if same or args.force:
                clearable.append(key)
            else:
                total_differing += 1
        if not clearable:
            continue
        total_cleared += len(clearable)
        if args.apply:
            # Blanked rather than deleted, matching how the repository stores a removal: an
            # empty value is read as absent, so the key resolves from the layer below.
            repository.update_workspace_provider_config(
                workspace_id=workspace_id,
                user_id=_any_user_id(repository, workspace_id),
                values={},
                removed_keys=clearable,
                now=time.time(),
            )
            print(f"  -> 已清理 {len(clearable)} 个键")
        else:
            print(f"  -> 将清理 {len(clearable)} 个键（加 --apply 才写入）")

    print(f"\n{'已清理' if args.apply else '待清理'} {total_cleared} 个键，"
          f"{total_differing} 个与下层不同已跳过（如确认要清，加 --force）")
    if not args.apply:
        print("这是预演，数据未改动。")
    return 0


def _any_user_id(repository: AuthRepository, workspace_id: str) -> str:
    """updated_by_user_id is a real foreign key, so the audit column needs a live account."""
    from src.storage.schema import WorkspaceMembership

    with repository.engine.connect() as connection:
        user_id = connection.execute(
            select(WorkspaceMembership.user_id).where(
                WorkspaceMembership.workspace_id == workspace_id
            ).limit(1)
        ).scalar_one_or_none()
    if user_id is None:
        raise SystemExit(f"workspace {workspace_id} has no members; cannot attribute the change")
    return str(user_id)


if __name__ == "__main__":
    raise SystemExit(main())
