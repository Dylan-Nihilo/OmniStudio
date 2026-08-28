"""Short-lived SQLAlchemy Core repository for the W1 Script/Series payloads.

SQLite is the source of truth in W1.  The pipeline may keep its Pydantic objects in
memory, but persistence goes through this module so that payloads and their future
Project/Episode envelopes are written atomically.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Mapping
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.engine import Connection, Engine

from src.apps.comic_gen.models import Episode as EpisodePayload
from src.apps.comic_gen.models import Project as ProjectPayload
from src.apps.comic_gen.models import ProjectMode
from src.apps.comic_gen.models import Script as ScriptPayload
from src.apps.comic_gen.models import Series as SeriesPayload

from .errors import StorageError
from .schema import Episode, Project, Script, Series

logger = logging.getLogger(__name__)

PayloadT = TypeVar("PayloadT", ScriptPayload, SeriesPayload)


class _LoadedProject(ProjectPayload):
    """Repository view that includes the Episodes assembled for a Project."""

    episodes: list[EpisodePayload]


class SQLiteRepository:
    """Repository facade over the W1 SQLite schema.

    Methods deliberately use a short ``Engine.begin()`` transaction and SQLAlchemy
    Core tables rather than exposing ORM sessions to the pipeline.  The repository
    does not own a process-wide lock; callers such as ``ComicGenPipeline`` hold the
    existing write lock around a full cache flush.
    """

    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    # ------------------------------------------------------------------
    # Public read API
    # ------------------------------------------------------------------
    def load_scripts(self) -> dict[str, ScriptPayload]:
        """Load and validate every persisted Script, failing closed on bad data."""
        try:
            with self.engine.connect() as connection:
                rows = connection.execute(
                    select(Script.__table__).order_by(Script.__table__.c.id)
                ).mappings()
                return {
                    self._validate_loaded_payload(row, payload): payload
                    for row in rows
                    for payload in [
                        self._parse_payload(
                            row,
                            ScriptPayload,
                            table_name="scripts",
                        )
                    ]
                }
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to load scripts: {exc}") from exc

    def load_series(self) -> dict[str, SeriesPayload]:
        """Load and validate every persisted Series, failing closed on bad data."""
        try:
            with self.engine.connect() as connection:
                rows = connection.execute(
                    select(Series.__table__).order_by(Series.__table__.c.id)
                ).mappings()
                return {
                    self._validate_loaded_payload(row, payload): payload
                    for row in rows
                    for payload in [
                        self._parse_payload(
                            row,
                            SeriesPayload,
                            table_name="series",
                        )
                    ]
                }
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to load series: {exc}") from exc

    def load_projects(self) -> dict[str, ProjectPayload]:
        """Load complete W2 Project views from the four normalized storage tables.

        Project and Episode rows are authoritative for relationships and ordering;
        Script/Series payloads supply their nested production and shared content.
        """
        try:
            with self.engine.connect() as connection:
                project_rows = connection.execute(
                    select(Project.__table__).order_by(Project.__table__.c.id)
                ).mappings()
                projects: dict[str, ProjectPayload] = {}

                for project_row in project_rows:
                    project_id = project_row["id"]
                    episode_rows = connection.execute(
                        select(Episode.__table__, Script.__table__)
                        .join(
                            Script.__table__,
                            Script.__table__.c.episode_id == Episode.__table__.c.id,
                        )
                        .where(Episode.__table__.c.project_id == project_id)
                        .order_by(
                            Episode.__table__.c.episode_number,
                            Episode.__table__.c.created_at,
                            Episode.__table__.c.id,
                        )
                    ).mappings()

                    episodes: list[EpisodePayload] = []
                    for episode_row in episode_rows:
                        script_row = {
                            column.name: episode_row[column]
                            for column in Script.__table__.columns
                        }
                        script = self._parse_payload(
                            script_row,
                            ScriptPayload,
                            table_name="scripts",
                        )
                        self._validate_loaded_payload(script_row, script)
                        episodes.append(
                            EpisodePayload(
                                id=episode_row[Episode.__table__.c.id],
                                project_id=episode_row[Episode.__table__.c.project_id],
                                series_id=episode_row[Episode.__table__.c.series_id],
                                episode_number=episode_row[
                                    Episode.__table__.c.episode_number
                                ],
                                script=script.model_copy(
                                    deep=True,
                                    update={"series_id": None, "episode_number": None},
                                ),
                                created_at=episode_row[Episode.__table__.c.created_at],
                                updated_at=episode_row[Episode.__table__.c.updated_at],
                            )
                        )

                    shared_values: dict[str, Any] = {}
                    if project_row["mode"] == ProjectMode.SERIES.value:
                        series_row = connection.execute(
                            select(Series.__table__).where(
                                Series.__table__.c.project_id == project_id
                            )
                        ).mappings().first()
                        if series_row is None:
                            logger.warning(
                                "Series Project %s has no Series row; loading an empty shared-asset shell",
                                project_id,
                            )
                        else:
                            series = self._parse_payload(
                                series_row,
                                SeriesPayload,
                                table_name="series",
                            )
                            self._validate_loaded_payload(series_row, series)
                            shared_values = {
                                "characters": [
                                    item.model_copy(deep=True) for item in series.characters
                                ],
                                "scenes": [item.model_copy(deep=True) for item in series.scenes],
                                "props": [item.model_copy(deep=True) for item in series.props],
                                "art_direction": (
                                    series.art_direction.model_copy(deep=True)
                                    if series.art_direction is not None
                                    else None
                                ),
                                "prompt_config": series.prompt_config.model_copy(deep=True),
                                "model_settings": series.model_settings.model_copy(deep=True),
                                "workflow_mode": series.workflow_mode,
                                "default_generation_mode": series.default_generation_mode,
                                "custom_voices": [
                                    item.model_copy(deep=True) for item in series.custom_voices
                                ],
                                "content_mode": series.content_mode,
                            }

                    project = _LoadedProject(
                        id=project_id,
                        title=project_row["title"],
                        mode=ProjectMode(project_row["mode"]),
                        workspace_id=project_row["workspace_id"],
                        episode_ids=[episode.id for episode in episodes],
                        episodes=episodes,
                        created_at=project_row["created_at"],
                        updated_at=project_row["updated_at"],
                        **shared_values,
                    )
                    projects[project_id] = project

                return projects
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to load projects: {exc}") from exc

    # ------------------------------------------------------------------
    # Public write API
    # ------------------------------------------------------------------
    def save_scripts(self, scripts: Mapping[str, ScriptPayload]) -> None:
        """Atomically upsert all Script payloads and their Project/Episode envelopes.

        A standalone Script uses its own ID for both the Project and Episode.  A
        Script with ``series_id`` uses the Series ID as its Project ID.  If that
        Series is not yet present, a recoverable placeholder Series and Project are
        created so the schema's foreign keys remain valid; a warning is logged for
        later migration/review.
        """
        prepared = self._prepare_payloads(scripts, ScriptPayload, "scripts")
        try:
            with self.engine.begin() as connection:
                self._save_prepared_scripts(connection, prepared)
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to save scripts; transaction rolled back: {exc}") from exc

    def save_series(self, series_map: Mapping[str, SeriesPayload]) -> None:
        """Atomically upsert Series payloads and their ``mode='series'`` Projects."""
        prepared = self._prepare_payloads(series_map, SeriesPayload, "series")
        try:
            with self.engine.begin() as connection:
                self._save_prepared_series(connection, prepared)
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to save series; transaction rolled back: {exc}") from exc

    def save_bundle(
        self,
        scripts: Mapping[str, ScriptPayload],
        series_map: Mapping[str, SeriesPayload],
    ) -> None:
        """Atomically upsert Series and Script payloads plus all relationship envelopes.

        This is the transaction boundary intended for the later Pipeline bundle
        write.  Series are written first so an Episode's ``series_id`` foreign key
        can be satisfied in the same transaction.
        """
        prepared_scripts = self._prepare_payloads(scripts, ScriptPayload, "scripts")
        prepared_series = self._prepare_payloads(series_map, SeriesPayload, "series")
        try:
            with self.engine.begin() as connection:
                self._save_prepared_series(connection, prepared_series)
                self._save_prepared_scripts(connection, prepared_scripts)
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to save bundle; transaction rolled back: {exc}") from exc

    def delete_script(self, script_id: str) -> None:
        """Delete one Script and its Episode envelope.

        For a standalone Script, its same-ID standalone Project envelope is also
        removed.  A Series Project is retained, as are other Series-owned
        envelopes; deleting an episode must never cascade into the Series payload.
        """
        self._validate_id(script_id, "script_id")
        try:
            with self.engine.begin() as connection:
                episode = connection.execute(
                    select(Episode.__table__.c.project_id).where(
                        Episode.__table__.c.id == script_id
                    )
                ).mappings().first()
                connection.execute(
                    delete(Script.__table__).where(Script.__table__.c.id == script_id)
                )
                connection.execute(
                    delete(Episode.__table__).where(Episode.__table__.c.id == script_id)
                )
                if episode and episode["project_id"] == script_id:
                    connection.execute(
                        delete(Project.__table__).where(
                            Project.__table__.c.id == script_id,
                            Project.__table__.c.mode == "standalone",
                        )
                    )
        except Exception as exc:
            raise StorageError(f"Failed to delete script {script_id}; transaction rolled back: {exc}") from exc

    def delete_series(self, series_id: str) -> None:
        """Delete a Series payload while preserving its Project/Episode content.

        Per W1 design R11, this explicitly nulls ``episodes.series_id`` first and
        deletes only the Series row.  The Series Project envelope identified by
        ``series.project_id`` remains in place, so deleting a Series cannot
        accidentally delete its Script/Episode data.  This intentionally does not
        rely on SQLite's FK action to express the application-level behavior.
        """
        self._validate_id(series_id, "series_id")
        try:
            with self.engine.begin() as connection:
                row = connection.execute(
                    select(Series.__table__.c.project_id).where(
                        Series.__table__.c.id == series_id
                    )
                ).mappings().first()
                connection.execute(
                    update(Episode.__table__)
                    .where(Episode.__table__.c.series_id == series_id)
                    .values(series_id=None)
                )
                connection.execute(
                    delete(Series.__table__).where(Series.__table__.c.id == series_id)
                )
                # ``row`` is intentionally not used to delete a Project: R11 keeps
                # the envelope as a durable container for the surviving episodes.
                _ = row
        except Exception as exc:
            raise StorageError(f"Failed to delete series {series_id}; transaction rolled back: {exc}") from exc

    # ------------------------------------------------------------------
    # Preparation and transactional write helpers
    # ------------------------------------------------------------------
    def _prepare_payloads(
        self,
        values: Mapping[str, PayloadT],
        model_type: type[PayloadT],
        table_name: str,
    ) -> list[tuple[str, PayloadT, str, str]]:
        prepared: list[tuple[str, PayloadT, str, str]] = []
        try:
            for mapping_id, payload in values.items():
                self._validate_id(mapping_id, f"{table_name} mapping key")
                if not isinstance(payload, model_type):
                    payload = model_type.model_validate(payload)
                payload_id = getattr(payload, "id", None)
                self._validate_id(payload_id, f"{table_name} payload id")
                if mapping_id != payload_id:
                    raise StorageError(
                        f"{table_name} mapping key {mapping_id!r} does not match payload id {payload_id!r}"
                    )
                payload_json = self._dump_payload(payload)
                prepared.append(
                    (payload_id, payload, payload_json, self._payload_hash(payload_id, payload_json))
                )
        except StorageError:
            raise
        except (ValidationError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise StorageError(f"Invalid {table_name} payload: {exc}") from exc
        except Exception as exc:
            raise StorageError(f"Failed to prepare {table_name} payloads: {exc}") from exc
        return prepared

    def _save_prepared_scripts(
        self,
        connection: Connection,
        prepared: list[tuple[str, ScriptPayload, str, str]],
    ) -> None:
        for script_id, payload, payload_json, payload_sha256 in prepared:
            series_id = payload.series_id
            project_id = series_id or script_id
            project_title = payload.title
            project_created_at = payload.created_at
            if series_id:
                series_row = connection.execute(
                    select(Series.__table__.c.title, Series.__table__.c.created_at).where(
                        Series.__table__.c.id == series_id
                    )
                ).mappings().first()
                if series_row:
                    project_title = series_row["title"]
                    project_created_at = series_row["created_at"]
                else:
                    logger.warning(
                        "Script %s references missing Series %s; creating a recovered placeholder",
                        script_id,
                        series_id,
                    )
                    placeholder = SeriesPayload(
                        id=series_id,
                        title=f"[Recovered series {series_id}]",
                        created_at=payload.created_at,
                        updated_at=payload.updated_at,
                    )
                    placeholder_json = self._dump_payload(placeholder)
                    # The Series row references its Project, so create the
                    # placeholder Project before inserting the recovered Series.
                    self._upsert_project(
                        connection,
                        project_id=series_id,
                        title=placeholder.title,
                        mode="series",
                        legacy_series_id=series_id,
                        created_at=placeholder.created_at,
                        updated_at=placeholder.updated_at,
                    )
                    self._upsert_series(
                        connection,
                        series_id,
                        placeholder,
                        placeholder_json,
                        self._payload_hash(series_id, placeholder_json),
                    )
                    project_title = placeholder.title
                    project_created_at = placeholder.created_at

            self._upsert_project(
                connection,
                project_id=project_id,
                title=project_title,
                mode="series" if series_id else "standalone",
                legacy_series_id=series_id,
                created_at=project_created_at,
                updated_at=payload.updated_at,
            )
            self._upsert_episode(
                connection,
                payload,
                project_id=project_id,
                series_id=series_id,
            )
            self._upsert_script(connection, script_id, payload, payload_json, payload_sha256)

    def _save_prepared_series(
        self,
        connection: Connection,
        prepared: list[tuple[str, SeriesPayload, str, str]],
    ) -> None:
        for series_id, payload, payload_json, payload_sha256 in prepared:
            self._upsert_project(
                connection,
                project_id=series_id,
                title=payload.title,
                mode="series",
                legacy_series_id=series_id,
                created_at=payload.created_at,
                updated_at=payload.updated_at,
            )
            self._upsert_series(
                connection,
                series_id,
                payload,
                payload_json,
                payload_sha256,
            )

    def _upsert_project(
        self,
        connection: Connection,
        *,
        project_id: str,
        title: str,
        mode: str,
        legacy_series_id: str | None,
        created_at: float,
        updated_at: float,
    ) -> None:
        table = Project.__table__
        existing = connection.execute(
            select(table.c.id).where(table.c.id == project_id)
        ).first()
        values = {
            "id": project_id,
            "title": title,
            "description": "",
            "mode": mode,
            "legacy_series_id": legacy_series_id,
            "created_at": created_at,
            "updated_at": updated_at,
            "metadata_json": "{}",
        }
        if existing is None:
            connection.execute(table.insert(), values)
        else:
            connection.execute(
                update(table)
                .where(table.c.id == project_id)
                .values(
                    title=title,
                    mode=mode,
                    legacy_series_id=legacy_series_id,
                    updated_at=updated_at,
                )
            )

    def _upsert_episode(
        self,
        connection: Connection,
        payload: ScriptPayload,
        *,
        project_id: str,
        series_id: str | None,
    ) -> None:
        table = Episode.__table__
        existing = connection.execute(
            select(table.c.id).where(table.c.id == payload.id)
        ).first()
        values = {
            "id": payload.id,
            "project_id": project_id,
            "series_id": series_id,
            "title": payload.title,
            "episode_number": payload.episode_number,
            "status": "draft",
            "created_at": payload.created_at,
            "updated_at": payload.updated_at,
            "metadata_json": "{}",
        }
        if existing is None:
            connection.execute(table.insert(), values)
        else:
            connection.execute(
                update(table)
                .where(table.c.id == payload.id)
                .values(
                    project_id=project_id,
                    series_id=series_id,
                    title=payload.title,
                    episode_number=payload.episode_number,
                    updated_at=payload.updated_at,
                )
            )

    def _upsert_script(
        self,
        connection: Connection,
        script_id: str,
        payload: ScriptPayload,
        payload_json: str,
        payload_sha256: str,
    ) -> None:
        table = Script.__table__
        existing = connection.execute(
            select(table.c.payload_sha256).where(table.c.id == script_id)
        ).first()
        if existing is not None and existing[0] == payload_sha256:
            return
        values = {
            "id": script_id,
            "episode_id": script_id,
            "original_text": payload.original_text,
            "payload_json": payload_json,
            "payload_schema_version": 1,
            "payload_sha256": payload_sha256,
            "created_at": payload.created_at,
            "updated_at": payload.updated_at,
        }
        if existing is None:
            connection.execute(table.insert(), values)
        else:
            connection.execute(
                update(table)
                .where(table.c.id == script_id)
                .values(
                    original_text=payload.original_text,
                    payload_json=payload_json,
                    payload_schema_version=1,
                    payload_sha256=payload_sha256,
                    updated_at=payload.updated_at,
                )
            )

    def _upsert_series(
        self,
        connection: Connection,
        series_id: str,
        payload: SeriesPayload,
        payload_json: str,
        payload_sha256: str,
    ) -> None:
        table = Series.__table__
        existing = connection.execute(
            select(table.c.payload_sha256).where(table.c.id == series_id)
        ).first()
        if existing is not None and existing[0] == payload_sha256:
            return
        values = {
            "id": series_id,
            "project_id": series_id,
            "title": payload.title,
            "description": payload.description,
            "payload_json": payload_json,
            "payload_schema_version": 1,
            "payload_sha256": payload_sha256,
            "created_at": payload.created_at,
            "updated_at": payload.updated_at,
        }
        if existing is None:
            connection.execute(table.insert(), values)
        else:
            connection.execute(
                update(table)
                .where(table.c.id == series_id)
                .values(
                    project_id=series_id,
                    title=payload.title,
                    description=payload.description,
                    payload_json=payload_json,
                    payload_schema_version=1,
                    payload_sha256=payload_sha256,
                    updated_at=payload.updated_at,
                )
            )

    # ------------------------------------------------------------------
    # Validation/serialization helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _validate_id(value: Any, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise StorageError(f"Invalid {label}: id must be a non-empty string")
        return value

    @staticmethod
    def _dump_payload(payload: BaseModel) -> str:
        try:
            data = payload.model_dump(mode="json")
            return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        except Exception as exc:
            raise StorageError(f"Could not serialize payload: {exc}") from exc

    @staticmethod
    def _payload_hash(payload_id: str, payload_json: str) -> str:
        """Hash the identity followed by canonical JSON, as specified for W1."""
        return hashlib.sha256(f"{payload_id}{payload_json}".encode("utf-8")).hexdigest()

    @staticmethod
    def _parse_payload(
        row: Mapping[str, Any],
        model_type: type[PayloadT],
        *,
        table_name: str,
    ) -> PayloadT:
        row_id = row["id"]
        try:
            decoded = json.loads(row["payload_json"])
            return model_type.model_validate(decoded)
        except (json.JSONDecodeError, TypeError, ValueError, ValidationError) as exc:
            raise StorageError(f"Corrupt {table_name} payload for row {row_id!r}: {exc}") from exc

    @staticmethod
    def _validate_loaded_payload(row: Mapping[str, Any], payload: BaseModel) -> str:
        row_id = row["id"]
        payload_id = getattr(payload, "id", None)
        if row_id != payload_id:
            raise StorageError(
                f"{row_id!r} row id does not match payload id {payload_id!r}"
            )
        return row_id


# A descriptive alias keeps callers free to choose either repository naming style.
Repository = SQLiteRepository

__all__ = ["Repository", "SQLiteRepository"]




