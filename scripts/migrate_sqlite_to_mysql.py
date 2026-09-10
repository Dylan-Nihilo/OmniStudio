"""Copy the Omni Studio storage database from SQLite to MySQL (or any SQLAlchemy target).

Usage:
    python scripts/migrate_sqlite_to_mysql.py \
        --source sqlite:///output/omni_studio.db \
        --target "mysql+pymysql://omnistudio:***@127.0.0.1:3306/omnistudio?charset=utf8mb4" \
        [--dry-run] [--truncate] [--batch-size 1000] [--report output/migration-report.json]

Behaviour:
    1. Creates the schema on the target with ``Base.metadata.create_all`` (no-op for existing tables).
    2. Copies every table in foreign-key order in batches, with FK checks disabled on MySQL.
    3. Verifies each table: row count and an order-independent SHA-256 over all rows must match.
    4. Writes a JSON report and exits non-zero if any table fails verification.

The source is never modified. Re-running with ``--truncate`` makes the copy idempotent.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import warnings
from pathlib import Path
from typing import Any

from sqlalchemy import String, create_engine, func, insert, inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SAWarning
from sqlalchemy.schema import Table

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.storage.schema import Base  # noqa: E402


def _dialect(engine: Engine) -> str:
    return engine.dialect.name


def _row_digest(row: dict[str, Any]) -> bytes:
    return hashlib.sha256(json.dumps(row, sort_keys=True, default=str, ensure_ascii=False).encode("utf-8")).digest()


def table_fingerprint(engine: Engine, table: Table, batch_size: int) -> tuple[int, str]:
    """Return (row_count, hex digest). The digest XORs per-row hashes so row order does not matter."""
    acc = bytearray(32)
    count = 0
    with engine.connect() as conn:
        result = conn.execution_options(stream_results=True).execute(select(table))
        while True:
            rows = result.mappings().fetchmany(batch_size)
            if not rows:
                break
            for row in rows:
                digest = _row_digest(dict(row))
                for i in range(32):
                    acc[i] ^= digest[i]
                count += 1
    return count, bytes(acc).hex()


def check_column_widths(conn: Any, tables: list[Table]) -> list[dict[str, Any]]:
    """SQLite ignores VARCHAR lengths, MySQL enforces them; refuse to start if any value would be truncated."""
    overflow = []
    for table in tables:
        for column in table.columns:
            if type(column.type) is String and column.type.length:
                longest = conn.scalar(select(func.max(func.length(column)))) or 0
                if longest > column.type.length:
                    overflow.append({"column": f"{table.name}.{column.name}", "max_length": int(longest),
                                     "limit": column.type.length})
    return overflow


def copy_table(source: Engine, target: Engine, table: Table, batch_size: int) -> int:
    copied = 0
    with source.connect() as src, target.begin() as dst:
        if _dialect(target) == "mysql":
            dst.execute(text("SET SESSION FOREIGN_KEY_CHECKS=0"))   # same connection as the inserts
        result = src.execution_options(stream_results=True).execute(select(table))
        while True:
            rows = [dict(r) for r in result.mappings().fetchmany(batch_size)]
            if not rows:
                break
            dst.execute(insert(table), rows)
            copied += len(rows)
    return copied


def truncate_all(engine: Engine, tables: list[Table]) -> None:
    with engine.begin() as conn:
        if _dialect(engine) == "mysql":
            conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for table in reversed(tables):
            conn.execute(table.delete())
        if _dialect(engine) == "mysql":
            conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))


def run(source_url: str, target_url: str, *, dry_run: bool, truncate: bool, batch_size: int) -> dict[str, Any]:
    source = create_engine(source_url, future=True)
    target = create_engine(target_url, future=True, pool_pre_ping=True)
    # source_chapters <-> source_revisions reference each other; the copy runs with FK checks off on MySQL
    # and SQLite only enforces FKs when the pragma is on, so the partial order is sufficient.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SAWarning)
        tables = list(Base.metadata.sorted_tables)
    report: dict[str, Any] = {"source": source_url, "target": target_url.split("@")[-1], "dry_run": dry_run,
                              "started_at": time.time(), "tables": {}, "ok": True}

    with source.connect() as conn:
        existing = set(inspect(conn).get_table_names())
        missing = [t.name for t in tables if t.name not in existing]
        if missing:
            raise SystemExit(f"source database lacks tables {missing}; run init_schema / the app once before migrating")
        for table in tables:
            report["tables"][table.name] = {"source_rows": conn.scalar(select(func.count()).select_from(table))}
        overflow = check_column_widths(conn, tables)
        report["width_check"] = overflow
        if overflow:
            raise SystemExit("source values exceed the target VARCHAR width; widen the schema first: "
                             + ", ".join(f"{o['column']} max {o['max_length']} > {o['limit']}" for o in overflow))
    with target.connect() as conn:
        conn.execute(text("SELECT 1"))

    if dry_run:
        report["finished_at"] = time.time()
        return report

    Base.metadata.create_all(target)
    if truncate:
        truncate_all(target, tables)

    for table in tables:
        started = time.perf_counter()
        entry = report["tables"][table.name]
        entry["copied_rows"] = copy_table(source, target, table, batch_size)
        src_count, src_digest = table_fingerprint(source, table, batch_size)
        dst_count, dst_digest = table_fingerprint(target, table, batch_size)
        entry.update({"target_rows": dst_count, "source_digest": src_digest, "target_digest": dst_digest,
                      "seconds": round(time.perf_counter() - started, 3),
                      "ok": src_count == dst_count and src_digest == dst_digest})
        if not entry["ok"]:
            report["ok"] = False

    report["finished_at"] = time.time()
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--truncate", action="store_true", help="empty target tables before copying")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--report", default="output/migration-report.json")
    args = parser.parse_args(argv)

    report = run(args.source, args.target, dry_run=args.dry_run, truncate=args.truncate, batch_size=args.batch_size)
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    for name, entry in report["tables"].items():
        status = "dry" if args.dry_run else ("OK " if entry.get("ok") else "FAIL")
        print(f"{status} {name:40} {entry.get('source_rows', 0):>7} -> {entry.get('target_rows', '-'):>7}")
    print(f"report: {args.report}  overall: {'OK' if report['ok'] else 'FAILED'}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
