"""Copy/verify logic of scripts/migrate_sqlite_to_mysql.py, exercised SQLite -> SQLite.

The MySQL-specific branches (FOREIGN_KEY_CHECKS) are dialect-gated and not covered here;
set OMNI_STUDIO_TEST_MYSQL_URL to run the same round-trip against a real MySQL.
"""

from __future__ import annotations

import importlib.util
import os
import time
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, insert, select, func
from sqlalchemy.exc import IntegrityError

from src.storage.db import init_schema
from src.storage.schema import Base, User, Workspace, WorkspaceMembership

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "migrate_sqlite_to_mysql.py"
spec = importlib.util.spec_from_file_location("migrate_sqlite_to_mysql", SCRIPT)
migrate = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(migrate)


def _seed(url: str) -> None:
    engine = create_engine(url, future=True)
    init_schema(engine)
    now = time.time()
    with engine.begin() as conn:
        for i in range(3):
            uid, wid = str(uuid.uuid4()), str(uuid.uuid4())
            conn.execute(insert(User.__table__).values(
                id=uid, username=f"user{i}", username_normalized=f"user{i}", email=f"u{i}@x.io",
                email_normalized=f"u{i}@x.io", display_name="用户 %d" % i, password_hash="x", created_at=now,
                updated_at=now, metadata_json='{"k": "值"}'))
            conn.execute(insert(Workspace.__table__).values(
                id=wid, owner_user_id=uid, name=f"ws{i}", slug=f"ws{i}", created_at=now, updated_at=now,
                metadata_json="{}"))
            conn.execute(insert(WorkspaceMembership.__table__).values(
                workspace_id=wid, user_id=uid, role="owner", joined_at=now))
    engine.dispose()


def test_round_trip_copies_and_verifies(tmp_path: Path) -> None:
    source = f"sqlite:///{tmp_path / 'source.db'}"
    target = f"sqlite:///{tmp_path / 'target.db'}"
    _seed(source)

    report = migrate.run(source, target, dry_run=False, truncate=False, batch_size=2)

    assert report["ok"] is True
    assert report["tables"]["users"]["source_rows"] == 3
    assert report["tables"]["users"]["target_rows"] == 3
    assert report["tables"]["users"]["source_digest"] == report["tables"]["users"]["target_digest"]
    assert set(report["tables"]) == set(Base.metadata.tables)

    engine = create_engine(target, future=True)
    with engine.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(WorkspaceMembership.__table__)) == 3
        assert conn.scalar(select(User.display_name).where(User.username == "user1")) == "用户 1"


def test_rerun_with_truncate_is_idempotent(tmp_path: Path) -> None:
    source = f"sqlite:///{tmp_path / 'source.db'}"
    target = f"sqlite:///{tmp_path / 'target.db'}"
    _seed(source)
    assert migrate.run(source, target, dry_run=False, truncate=False, batch_size=100)["ok"]
    assert migrate.run(source, target, dry_run=False, truncate=True, batch_size=100)["ok"]
    with pytest.raises(IntegrityError):  # a non-empty target without --truncate must abort, never silently merge
        migrate.run(source, target, dry_run=False, truncate=False, batch_size=100)


def test_dry_run_touches_nothing(tmp_path: Path) -> None:
    source = f"sqlite:///{tmp_path / 'source.db'}"
    target_path = tmp_path / "target.db"
    _seed(source)
    report = migrate.run(source, f"sqlite:///{target_path}", dry_run=True, truncate=False, batch_size=100)
    assert report["dry_run"] and report["ok"]
    assert "copied_rows" not in report["tables"]["users"]


@pytest.mark.skipif(not os.environ.get("OMNI_STUDIO_TEST_MYSQL_URL"), reason="needs a MySQL test database")
def test_round_trip_into_mysql(tmp_path: Path) -> None:
    source = f"sqlite:///{tmp_path / 'source.db'}"
    _seed(source)
    report = migrate.run(source, os.environ["OMNI_STUDIO_TEST_MYSQL_URL"], dry_run=False, truncate=True, batch_size=100)
    assert report["ok"], report
