"""Fail-closed legacy JSON to SQLite migration for Omni Studio W1.

The public API intentionally returns plain dictionaries so callers and the CLI can
serialize migration reports without depending on an additional model layer.
``preview`` never creates or mutates the target database.  ``apply`` performs a
full preflight, creates verified backups, and commits the repository bundle and
its completed audit row in one database transaction.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import shutil
import sqlite3
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence, TypeAlias, cast
from urllib.parse import unquote, urlparse

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.engine import Connection, Engine

from src.apps.comic_gen.models import Script as ScriptPayload
from src.apps.comic_gen.models import Series as SeriesPayload

from .db import DEFAULT_DB_PATH, create_engine, init_schema
from .errors import LegacyDataError, MigrationError, StorageError
from .repository import SQLiteRepository
from .schema import Episode, MigrationRun, Project, Script, Series

MIGRATION_NAME = "p0a_w1_json_to_sqlite"
SOURCE_NAME = "legacy_json_bundle"
MigrationReport: TypeAlias = dict[str, Any]


@dataclass
class _PreflightResult:
    report: dict[str, Any]
    scripts: dict[str, ScriptPayload]
    series: dict[str, SeriesPayload]


class _DuplicateJSONKey(ValueError):
    pass


class _TransactionBoundEngine:
    """Minimal Engine facade that lets ``save_bundle`` join an outer transaction."""

    def __init__(self, connection: Connection) -> None:
        self._connection = connection

    @contextlib.contextmanager
    def begin(self):
        yield self._connection


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _unique_json_object(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateJSONKey(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _read_json_source(path: Path, *, kind: str) -> tuple[dict[str, Any], dict[str, Any]]:
    metadata: dict[str, Any] = {
        "kind": kind,
        "path": str(path),
        "exists": path.is_file(),
        "records": 0,
        "sha256": None,
    }
    if not metadata["exists"]:
        return {}, metadata

    try:
        raw = path.read_bytes()
        metadata["sha256"] = _sha256_bytes(raw)
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise LegacyDataError(
            f"Legacy {kind} JSON is not valid UTF-8: {path} (byte {exc.start})"
        ) from exc
    except OSError as exc:
        raise LegacyDataError(f"Could not read legacy {kind} JSON {path}: {exc}") from exc

    try:
        decoded = json.loads(text, object_pairs_hook=_unique_json_object)
    except json.JSONDecodeError as exc:
        raise LegacyDataError(
            f"Invalid legacy {kind} JSON syntax in {path} at line {exc.lineno}, "
            f"column {exc.colno}: {exc.msg}"
        ) from exc
    except _DuplicateJSONKey as exc:
        raise LegacyDataError(f"Ambiguous legacy {kind} JSON in {path}: {exc}") from exc

    if not isinstance(decoded, dict):
        raise LegacyDataError(
            f"Legacy {kind} JSON root must be an object keyed by id: {path}"
        )
    metadata["records"] = len(decoded)
    return decoded, metadata


def _safe_validation_errors(exc: ValidationError) -> list[dict[str, Any]]:
    """Return validation diagnostics without echoing legacy payload content."""
    return [
        {
            "loc": [str(part) for part in item.get("loc", ())],
            "type": item.get("type", "validation_error"),
            "message": item.get("msg", "Invalid value"),
        }
        for item in exc.errors(include_url=False, include_context=False, include_input=False)
    ]


def _validate_records(
    records: Mapping[str, Any],
    model_type: type[ScriptPayload] | type[SeriesPayload],
    *,
    kind: str,
    errors: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
) -> dict[str, ScriptPayload] | dict[str, SeriesPayload]:
    parsed: dict[str, ScriptPayload] | dict[str, SeriesPayload] = {}
    ambiguous_ids: set[str] = set()

    for outer_key, value in records.items():
        try:
            payload = model_type.model_validate(value)
        except ValidationError as exc:
            errors.append(
                {
                    "type": "invalid_record",
                    "kind": kind,
                    "key": outer_key,
                    "validation": _safe_validation_errors(exc),
                }
            )
            continue
        except (TypeError, ValueError) as exc:
            errors.append(
                {
                    "type": "invalid_record",
                    "kind": kind,
                    "key": outer_key,
                    "message": str(exc),
                }
            )
            continue

        payload_id = payload.id
        if outer_key != payload_id:
            conflicts.append(
                {
                    "type": "key_id_mismatch",
                    "kind": kind,
                    "key": outer_key,
                    "payload_id": payload_id,
                }
            )
        if payload_id in parsed or payload_id in ambiguous_ids:
            conflicts.append(
                {
                    "type": "duplicate_payload_id",
                    "kind": kind,
                    "payload_id": payload_id,
                    "key": outer_key,
                }
            )
            parsed.pop(payload_id, None)
            ambiguous_ids.add(payload_id)
            continue
        parsed[payload_id] = payload

    return parsed


def _canonical_payload(payload: BaseModel) -> tuple[str, str]:
    data = payload.model_dump(mode="json")
    payload_json = json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    payload_id = str(getattr(payload, "id"))
    payload_sha256 = hashlib.sha256(f"{payload_id}{payload_json}".encode("utf-8")).hexdigest()
    return payload_json, payload_sha256


def _combined_source_hash(source_files: Sequence[Mapping[str, Any]]) -> str | None:
    if not source_files or not source_files[0].get("exists"):
        return None
    manifest = [
        {
            "kind": item["kind"],
            "exists": bool(item["exists"]),
            "sha256": item.get("sha256"),
        }
        for item in source_files
    ]
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return _sha256_bytes(encoded)


def _db_file_path(db_path: str | Path) -> Path | None:
    value = str(db_path)
    if value == ":memory:" or value in {"sqlite://", "sqlite:///:memory:"}:
        return None
    if value.startswith("sqlite:"):
        parsed = urlparse(value)
        if parsed.path in {"", "/:memory:"}:
            return None
        path_text = unquote(parsed.path)
        if sys.platform == "win32" and path_text.startswith("/") and len(path_text) > 2:
            path_text = path_text[1:]
        return Path(path_text)
    return Path(value)


def _fetch_existing_rows(
    connection: sqlite3.Connection,
    table: str,
    columns: Sequence[str],
    ids: Sequence[str],
) -> dict[str, dict[str, Any]]:
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    selected = ",".join(columns)
    cursor = connection.execute(
        f"SELECT {selected} FROM {table} WHERE id IN ({placeholders})",  # noqa: S608
        tuple(ids),
    )
    return {str(row["id"]): dict(row) for row in cursor.fetchall()}


def _same_projection(existing: Mapping[str, Any], expected: Mapping[str, Any]) -> bool:
    return all(existing.get(key) == value for key, value in expected.items())


def _inspect_db_actions(
    db_path: str | Path,
    expected: Mapping[str, Mapping[str, Mapping[str, Any]]],
) -> tuple[dict[str, int], dict[str, dict[str, str]]]:
    actions = {"insert": 0, "update": 0, "skip": 0}
    details: dict[str, dict[str, str]] = {name: {} for name in expected}
    db_file = _db_file_path(db_path)
    if db_file is None or not db_file.is_file():
        for table, rows in expected.items():
            for row_id in rows:
                details[table][row_id] = "insert"
                actions["insert"] += 1
        return actions, details

    uri = f"file:{db_file.resolve().as_posix()}?mode=ro&immutable=1"
    try:
        connection = sqlite3.connect(uri, uri=True)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        table_names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        for table, rows in expected.items():
            if table not in table_names:
                for row_id in rows:
                    details[table][row_id] = "insert"
                    actions["insert"] += 1
                continue
            columns = ["id", *next(iter(rows.values()), {}).keys()]
            columns = list(dict.fromkeys(columns))
            existing_rows = _fetch_existing_rows(connection, table, columns, list(rows))
            for row_id, projection in rows.items():
                existing = existing_rows.get(row_id)
                if existing is None:
                    action = "insert"
                elif _same_projection(existing, projection):
                    action = "skip"
                else:
                    action = "update"
                details[table][row_id] = action
                actions[action] += 1
    except sqlite3.DatabaseError as exc:
        raise MigrationError(f"Could not inspect target SQLite database {db_file}: {exc}") from exc
    finally:
        if "connection" in locals():
            connection.close()
    return actions, details


def _make_synthetic_series(
    scripts: Mapping[str, ScriptPayload],
    known_series: Mapping[str, SeriesPayload],
) -> tuple[dict[str, SeriesPayload], list[str]]:
    grouped: dict[str, list[ScriptPayload]] = {}
    for script in scripts.values():
        if script.series_id and script.series_id not in known_series:
            grouped.setdefault(script.series_id, []).append(script)

    synthetic: dict[str, SeriesPayload] = {}
    for series_id, episodes in grouped.items():
        ordered = sorted(
            episodes,
            key=lambda item: (
                item.episode_number is None,
                item.episode_number if item.episode_number is not None else 0,
                item.id,
            ),
        )
        synthetic[series_id] = SeriesPayload(
            id=series_id,
            title=f"[Recovered series {series_id}]",
            episode_ids=[item.id for item in ordered],
            created_at=min(item.created_at for item in ordered),
            updated_at=max(item.updated_at for item in ordered),
        )
    return synthetic, sorted(synthetic)


def _validate_relationships(
    scripts: Mapping[str, ScriptPayload],
    series_map: Mapping[str, SeriesPayload],
    *,
    conflicts: list[dict[str, Any]],
) -> None:
    for series_id, series in series_map.items():
        seen_episode_ids: set[str] = set()
        for episode_id in series.episode_ids:
            if episode_id in seen_episode_ids:
                conflicts.append(
                    {
                        "type": "duplicate_series_episode",
                        "series_id": series_id,
                        "script_id": episode_id,
                    }
                )
                continue
            seen_episode_ids.add(episode_id)
            script = scripts.get(episode_id)
            if script is None:
                conflicts.append(
                    {
                        "type": "series_episode_missing_script",
                        "series_id": series_id,
                        "script_id": episode_id,
                    }
                )
            elif script.series_id != series_id:
                conflicts.append(
                    {
                        "type": "series_script_binding_mismatch",
                        "series_id": series_id,
                        "script_id": episode_id,
                        "script_series_id": script.series_id,
                    }
                )

    for script_id, script in scripts.items():
        if not script.series_id or script.series_id not in series_map:
            continue
        if script_id not in series_map[script.series_id].episode_ids:
            conflicts.append(
                {
                    "type": "script_missing_from_series_episodes",
                    "series_id": script.series_id,
                    "script_id": script_id,
                }
            )


def _build_expected_rows(
    scripts: Mapping[str, ScriptPayload],
    series_map: Mapping[str, SeriesPayload],
    *,
    conflicts: list[dict[str, Any]],
) -> dict[str, dict[str, dict[str, Any]]]:
    expected: dict[str, dict[str, dict[str, Any]]] = {
        "projects": {},
        "episodes": {},
        "scripts": {},
        "series": {},
    }

    for series_id, payload in series_map.items():
        expected["projects"][series_id] = {
            "title": payload.title,
            "mode": "series",
            "legacy_series_id": series_id,
            "updated_at": payload.updated_at,
        }
        _, payload_hash = _canonical_payload(payload)
        expected["series"][series_id] = {"payload_sha256": payload_hash}

    for script_id, payload in scripts.items():
        project_id = payload.series_id or script_id
        if payload.series_id:
            parent = series_map[payload.series_id]
            project_projection = {
                "title": parent.title,
                "mode": "series",
                "legacy_series_id": payload.series_id,
                "updated_at": payload.updated_at,
            }
        else:
            project_projection = {
                "title": payload.title,
                "mode": "standalone",
                "legacy_series_id": None,
                "updated_at": payload.updated_at,
            }
        previous = expected["projects"].get(project_id)
        if previous is not None and previous["mode"] != project_projection["mode"]:
            conflicts.append(
                {
                    "type": "project_id_mode_collision",
                    "project_id": project_id,
                    "existing_mode": previous["mode"],
                    "incoming_mode": project_projection["mode"],
                }
            )
        else:
            # ``save_bundle`` writes scripts in source-object order; the last
            # episode for a Series therefore supplies the final Project timestamp.
            expected["projects"][project_id] = project_projection

        expected["episodes"][script_id] = {
            "project_id": project_id,
            "series_id": payload.series_id,
            "title": payload.title,
            "episode_number": payload.episode_number,
            "updated_at": payload.updated_at,
        }
        _, payload_hash = _canonical_payload(payload)
        expected["scripts"][script_id] = {"payload_sha256": payload_hash}

    return expected


def _run_preflight(
    source_projects_path: str | Path,
    source_series_path: str | Path | None,
    db_path: str | Path,
) -> _PreflightResult:
    projects_path = Path(source_projects_path)
    series_path = Path(source_series_path) if source_series_path is not None else None
    project_records, project_meta = _read_json_source(projects_path, kind="projects")
    source_files = [project_meta]

    if not project_meta["exists"]:
        if series_path is not None:
            source_files.append(
                {
                    "kind": "series",
                    "path": str(series_path),
                    "exists": series_path.is_file(),
                    "records": 0,
                    "sha256": _sha256_file(series_path) if series_path.is_file() else None,
                }
            )
        return _PreflightResult(
            report={
                "mode": "dry_run",
                "status": "ok",
                "ok": True,
                "source_missing": True,
                "source_files": source_files,
                "source_sha256": None,
                "counts": {
                    "source_records": 0,
                    "projects": 0,
                    "episodes": 0,
                    "scripts": 0,
                    "series": 0,
                    "synthetic_series": 0,
                },
                "actions": {"insert": 0, "update": 0, "skip": 0},
                "action_details": {
                    "projects": {},
                    "episodes": {},
                    "scripts": {},
                    "series": {},
                },
                "conflicts": [],
                "errors": [],
                "warnings": [
                    {
                        "type": "source_missing",
                        "path": str(projects_path),
                    }
                ],
                "synthetic_series": [],
                "backup_required_for_apply": False,
                "backups": [],
                "would_write": False,
            },
            scripts={},
            series={},
        )

    series_records: dict[str, Any] = {}
    if series_path is not None:
        series_records, series_meta = _read_json_source(series_path, kind="series")
        source_files.append(series_meta)

    errors: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    scripts = cast(
        dict[str, ScriptPayload],
        _validate_records(
            project_records,
            ScriptPayload,
            kind="projects",
            errors=errors,
            conflicts=conflicts,
        ),
    )
    real_series = cast(
        dict[str, SeriesPayload],
        _validate_records(
            series_records,
            SeriesPayload,
            kind="series",
            errors=errors,
            conflicts=conflicts,
        ),
    )

    _validate_relationships(scripts, real_series, conflicts=conflicts)
    synthetic, synthetic_ids = _make_synthetic_series(scripts, real_series)
    for series_id in synthetic_ids:
        warnings.append(
            {
                "type": "synthetic_series",
                "series_id": series_id,
                "message": "Script references a missing Series; a recovered placeholder will be created.",
            }
        )
    all_series = {**real_series, **synthetic}
    expected = _build_expected_rows(scripts, all_series, conflicts=conflicts)
    actions, action_details = _inspect_db_actions(db_path, expected)
    source_records = sum(int(item["records"]) for item in source_files)
    report = {
        "mode": "dry_run",
        "status": "ok" if not errors and not conflicts else "blocked",
        "ok": not errors and not conflicts,
        "source_missing": False,
        "source_files": source_files,
        "source_sha256": _combined_source_hash(source_files),
        "counts": {
            "source_records": source_records,
            "projects": len(expected["projects"]),
            "episodes": len(scripts),
            "scripts": len(scripts),
            "series": len(all_series),
            "synthetic_series": len(synthetic),
        },
        "actions": actions,
        "action_details": action_details,
        "conflicts": conflicts,
        "errors": errors,
        "warnings": warnings,
        "synthetic_series": synthetic_ids,
        "backup_required_for_apply": True,
        "backups": [],
        "would_write": bool(actions["insert"] or actions["update"]),
    }
    return _PreflightResult(report=report, scripts=scripts, series=all_series)


def preview(
    source_projects_path: str | Path,
    source_series_path: str | Path | None,
    db_path: str | Path,
) -> MigrationReport:
    """Fully validate and compare legacy sources without writing any file or table."""
    return _run_preflight(source_projects_path, source_series_path, db_path).report


def _backup_directory(db_path: str | Path) -> Path:
    db_file = _db_file_path(db_path)
    if db_file is None:
        raise MigrationError("Apply requires a file-backed SQLite database for verified backups")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    directory = db_file.parent / "backups" / f"{stamp}-{uuid.uuid4().hex[:8]}"
    directory.mkdir(parents=True, exist_ok=False)
    return directory


def _backup_file(source: Path, target: Path, *, kind: str) -> dict[str, Any]:
    try:
        source_hash = _sha256_file(source)
        shutil.copy2(source, target)
        backup_hash = _sha256_file(target)
    except OSError as exc:
        raise MigrationError(f"Failed to back up {kind} source {source}: {exc}") from exc
    if source_hash != backup_hash:
        raise MigrationError(
            f"Backup checksum mismatch for {kind}: source={source_hash}, backup={backup_hash}"
        )
    return {
        "kind": kind,
        "source_path": str(source),
        "backup_path": str(target),
        "source_sha256": source_hash,
        "sha256": backup_hash,
        "checksum_match": True,
    }


def _create_backups(
    source_projects_path: str | Path,
    source_series_path: str | Path | None,
    db_path: str | Path,
    *,
    include_db: bool,
) -> list[dict[str, Any]]:
    directory = _backup_directory(db_path)
    backups = [
        _backup_file(Path(source_projects_path), directory / "projects.json", kind="projects")
    ]
    if source_series_path is not None and Path(source_series_path).is_file():
        backups.append(
            _backup_file(Path(source_series_path), directory / "series.json", kind="series")
        )
    db_file = _db_file_path(db_path)
    if include_db and db_file is not None and db_file.is_file():
        backups.append(
            _backup_file(
                db_file,
                directory / "omni_studio.db.before-import.bak",
                kind="database",
            )
        )
    return backups


def _source_path_for_audit(report: Mapping[str, Any]) -> str:
    return json.dumps(
        [item["path"] for item in report["source_files"] if item.get("exists")],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _find_completed_runs(engine: Engine, source_sha256: str) -> tuple[bool, bool]:
    table = MigrationRun.__table__
    with engine.connect() as connection:
        rows = connection.execute(
            select(table.c.source_sha256).where(
                table.c.migration_name == MIGRATION_NAME,
                table.c.source_name == SOURCE_NAME,
                table.c.mode == "apply",
                table.c.status == "completed",
            )
        ).scalars().all()
    return source_sha256 in rows, bool(rows and source_sha256 not in rows)


def _has_business_rows(engine: Engine) -> bool:
    with engine.connect() as connection:
        return any(
            connection.scalar(select(func.count()).select_from(table))
            for table in (Project.__table__, Episode.__table__, Script.__table__, Series.__table__)
        )


def _write_audit(
    connection: Connection,
    report: Mapping[str, Any],
    *,
    status: str,
    error_text: str | None = None,
) -> None:
    source_sha256 = str(report["source_sha256"])
    table = MigrationRun.__table__
    existing = connection.execute(
        select(table.c.id).where(
            table.c.migration_name == MIGRATION_NAME,
            table.c.source_name == SOURCE_NAME,
            table.c.source_sha256 == source_sha256,
            table.c.mode == "apply",
        )
    ).first()
    now = time.time()
    values = {
        "migration_name": MIGRATION_NAME,
        "source_name": SOURCE_NAME,
        "source_path": _source_path_for_audit(report),
        "source_sha256": source_sha256,
        "mode": "apply",
        "status": status,
        "rows_seen": int(report["counts"]["source_records"]),
        "rows_inserted": int(report["actions"]["insert"]),
        "rows_updated": int(report["actions"]["update"]),
        "rows_skipped": int(report["actions"]["skip"]),
        "error_text": error_text[:4000] if error_text else None,
        "started_at": now,
        "completed_at": now if status in {"completed", "failed", "skipped"} else None,
    }
    if existing is None:
        connection.execute(table.insert(), {"id": uuid.uuid4().hex, **values})
    else:
        connection.execute(update(table).where(table.c.id == existing[0]).values(**values))


def _record_failed_audit(db_path: str | Path, report: Mapping[str, Any], message: str) -> None:
    if not report.get("source_sha256"):
        return
    engine = create_engine(db_path)
    try:
        init_schema(engine)
        with engine.begin() as connection:
            _write_audit(connection, report, status="failed", error_text=message)
    except Exception:
        # The original migration failure is more important than a best-effort audit.
        pass
    finally:
        engine.dispose()


def _format_blocked_message(report: Mapping[str, Any]) -> str:
    return (
        "Legacy JSON preflight blocked apply: "
        f"{len(report['errors'])} error(s), {len(report['conflicts'])} conflict(s). "
        "Run preview for sanitized diagnostics or pass force=True explicitly."
    )


def apply(
    source_projects_path: str | Path,
    source_series_path: str | Path | None,
    db_path: str | Path,
    force: bool = False,
) -> MigrationReport:
    """Back up and atomically import validated legacy JSON into SQLite."""
    result = _run_preflight(source_projects_path, source_series_path, db_path)
    report = result.report
    report["mode"] = "apply"
    report["force"] = bool(force)

    if report["source_missing"]:
        report["status"] = "skipped"
        report["would_write"] = False
        return report

    if (report["errors"] or report["conflicts"]) and not force:
        raise MigrationError(_format_blocked_message(report))
    if report["errors"] or report["conflicts"]:
        report["warnings"].append(
            {
                "type": "forced_apply_with_diagnostics",
                "errors": len(report["errors"]),
                "conflicts": len(report["conflicts"]),
                "invalid_records_skipped": len(report["errors"]),
            }
        )

    source_sha256 = report.get("source_sha256")
    if not source_sha256:
        report["status"] = "skipped"
        report["would_write"] = False
        return report

    db_file = _db_file_path(db_path)
    db_existed_before = bool(db_file and db_file.is_file())
    refusal_message: str | None = None
    engine = create_engine(db_path)
    try:
        init_schema(engine)
        same_completed, different_completed = _find_completed_runs(engine, source_sha256)
        if same_completed:
            report["status"] = "skipped"
            report["ok"] = True
            report["would_write"] = False
            report["warnings"].append({"type": "already_migrated", "sha256": source_sha256})
            return report

        existing_business_rows = _has_business_rows(engine)
        if (different_completed or existing_business_rows) and not force:
            refusal_message = (
                "Target SQLite already contains migrated or runtime data from a different "
                "legacy source hash; refusing to overwrite without force=True."
            )
            report["warnings"].append(
                {"type": "source_refresh_requires_force", "sha256": source_sha256}
            )
        elif force and db_existed_before:
            # Consolidate a closed single-process WAL before copying the DB file.
            with engine.connect() as connection:
                connection.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        engine.dispose()

    if refusal_message is not None:
        _record_failed_audit(db_path, report, refusal_message)
        raise MigrationError(refusal_message)

    try:
        report["backups"] = _create_backups(
            source_projects_path,
            source_series_path,
            db_path,
            include_db=bool(force and db_existed_before),
        )

        engine = create_engine(db_path)
        try:
            init_schema(engine)
            with engine.begin() as connection:
                bound_engine = cast(Engine, _TransactionBoundEngine(connection))
                SQLiteRepository(bound_engine).save_bundle(result.scripts, result.series)
                _write_audit(connection, report, status="completed")
        finally:
            engine.dispose()
    except Exception as exc:
        message = str(exc)
        _record_failed_audit(db_path, report, message)
        if isinstance(exc, MigrationError):
            raise
        if isinstance(exc, StorageError):
            raise MigrationError(f"Migration apply failed and was rolled back: {exc}") from exc
        raise MigrationError(f"Migration apply failed and was rolled back: {exc}") from exc

    report["status"] = "completed"
    report["ok"] = True
    report["would_write"] = False
    return report


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Migrate legacy Omni Studio JSON into SQLite")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="validate and preview only")
    mode.add_argument("--apply", action="store_true", help="back up and import into SQLite")
    parser.add_argument("--projects", default="output/projects.json", help="legacy projects.json path")
    parser.add_argument("--series", default="output/series.json", help="optional legacy series.json path")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="target SQLite database path")
    parser.add_argument(
        "--force",
        "--force-source-refresh",
        dest="force",
        action="store_true",
        help="explicitly refresh from a changed source after backing up the database",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.dry_run:
            report = preview(args.projects, args.series, args.db)
        else:
            report = apply(args.projects, args.series, args.db, force=args.force)
    except StorageError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "MIGRATION_NAME",
    "MigrationReport",
    "SOURCE_NAME",
    "apply",
    "main",
    "preview",
]


