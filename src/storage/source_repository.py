"""Workspace-scoped persistence for Source documents and their relationships."""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from typing import Any, Mapping

from sqlalchemy import and_, delete, exists, func, insert, or_, select, update
from sqlalchemy.engine import Engine

from .db import begin_immediate
from .schema import (
    Episode,
    Project,
    Script,
    Series,
    SourceChapter,
    SourceDocument,
    SourceEpisodeLink,
    SourceEpisodeSplitPreview,
    SourceImportPreview,
    SourceRevision,
)


class SourceRepositoryError(Exception):
    """Stable domain error translated into an API error envelope by the route."""

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _json(value: Mapping[str, Any] | None) -> str:
    return json.dumps(dict(value or {}), ensure_ascii=False, sort_keys=True)


def _metadata(raw: str) -> dict[str, Any]:
    value = json.loads(raw)
    return value if isinstance(value, dict) else {}


class SourceRepository:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    @staticmethod
    def _id(value: str, label: str) -> str:
        if not isinstance(value, str) or not value.strip() or len(value) > 200:
            raise SourceRepositoryError("SOURCE_INVALID_ID", f"{label} 不合法", status_code=422)
        return value

    def _source_row(self, connection, source_id: str, workspace_id: str):
        row = connection.execute(
            select(SourceDocument.__table__)
            .where(
                SourceDocument.id == self._id(source_id, "source_id"),
                SourceDocument.workspace_id == self._id(workspace_id, "workspace_id"),
            )
        ).mappings().first()
        if row is None:
            raise SourceRepositoryError("SOURCE_NOT_FOUND", "来源资料不存在", status_code=404)
        return row

    def _chapter_row(self, connection, source_id: str, chapter_id: str, workspace_id: str):
        row = connection.execute(
            select(SourceChapter.__table__)
            .join(SourceDocument, SourceDocument.id == SourceChapter.source_document_id)
            .where(
                SourceChapter.id == self._id(chapter_id, "chapter_id"),
                SourceChapter.source_document_id == self._id(source_id, "source_id"),
                SourceDocument.workspace_id == self._id(workspace_id, "workspace_id"),
            )
        ).mappings().first()
        if row is None:
            raise SourceRepositoryError("SOURCE_CHAPTER_NOT_FOUND", "来源章节不存在", status_code=404)
        return row

    def _preview_row(self, connection, preview_id: str, workspace_id: str):
        row = connection.execute(
            select(SourceImportPreview.__table__).where(
                SourceImportPreview.id == self._id(preview_id, "preview_id"),
                SourceImportPreview.workspace_id == self._id(workspace_id, "workspace_id"),
            )
        ).mappings().first()
        if row is None:
            raise SourceRepositoryError("SOURCE_IMPORT_PREVIEW_NOT_FOUND", "导入预览不存在", status_code=404)
        return row

    def _episode_split_preview_row(self, connection, preview_id: str, workspace_id: str):
        row = connection.execute(
            select(SourceEpisodeSplitPreview.__table__).where(
                SourceEpisodeSplitPreview.id == self._id(preview_id, "preview_id"),
                SourceEpisodeSplitPreview.workspace_id == self._id(workspace_id, "workspace_id"),
            )
        ).mappings().first()
        if row is None:
            raise SourceRepositoryError("SOURCE_EPISODE_SPLIT_PREVIEW_NOT_FOUND", "拆集预览不存在", status_code=404)
        return row

    @staticmethod
    def _document_payload(row: Mapping[str, Any], chapter_count: int, episode_count: int) -> dict[str, Any]:
        metadata = _metadata(str(row["metadata_json"]))
        return {
            "id": str(row["id"]),
            "workspace_id": str(row["workspace_id"]),
            "title": str(row["title"]),
            "source_type": str(row["source_type"]),
            "original_filename": row["original_filename"],
            "encoding": str(row["encoding"]),
            "summary": str(row["summary"]),
            "metadata": metadata,
            "imported_at": float(metadata["imported_at"]) if metadata.get("imported_at") is not None else None,
            "chapter_count": int(chapter_count),
            "linked_episode_count": int(episode_count),
            "created_at": float(row["created_at"]),
            "updated_at": float(row["updated_at"]),
        }

    @staticmethod
    def _revision_payload(row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "id": str(row["id"]),
            "source_document_id": str(row["source_document_id"]),
            "chapter_id": str(row["chapter_id"]),
            "revision_number": int(row["revision_number"]),
            "content": str(row["content"]),
            "content_sha256": str(row["content_sha256"]),
            "created_by_user_id": row["created_by_user_id"],
            "metadata": _metadata(str(row["metadata_json"])),
            "created_at": float(row["created_at"]),
        }

    def _revision(self, connection, revision_id: str | None) -> dict[str, Any] | None:
        if not revision_id:
            return None
        row = connection.execute(
            select(SourceRevision.__table__).where(SourceRevision.id == revision_id)
        ).mappings().first()
        return self._revision_payload(row) if row else None

    def _chapter_payload(self, connection, row: Mapping[str, Any]) -> dict[str, Any]:
        count = connection.execute(
            select(func.count()).select_from(SourceRevision).where(
                SourceRevision.chapter_id == row["id"]
            )
        ).scalar_one()
        return {
            "id": str(row["id"]),
            "source_document_id": str(row["source_document_id"]),
            "chapter_number": int(row["chapter_number"]),
            "title": str(row["title"]),
            "current_revision_id": row["current_revision_id"],
            "revision_count": int(count),
            "current_revision": self._revision(connection, row["current_revision_id"]),
            "created_at": float(row["created_at"]),
            "updated_at": float(row["updated_at"]),
        }

    @staticmethod
    def _episode_split_preview_payload(row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "id": str(row["id"]),
            "workspace_id": str(row["workspace_id"]),
            "source_document_id": str(row["source_document_id"]),
            "title": str(row["title"]),
            "content_sha256": str(row["content_sha256"]),
            "suggested_episodes": int(row["suggested_episodes"]),
            "proposals": json.loads(str(row["proposals_json"])),
            "status": str(row["status"]),
            "series_id": row["series_id"],
            "episode_ids": json.loads(str(row["episode_ids_json"])),
            "created_at": float(row["created_at"]),
            "updated_at": float(row["updated_at"]),
        }

    def _source_split_content(self, connection, source_id: str, workspace_id: str) -> tuple[dict[str, Any], str, str]:
        source = self._source_row(connection, source_id, workspace_id)
        rows = connection.execute(
            select(
                SourceChapter.chapter_number,
                SourceChapter.title,
                SourceChapter.current_revision_id,
                SourceRevision.content,
            )
            .join(SourceRevision, SourceRevision.id == SourceChapter.current_revision_id)
            .where(SourceChapter.source_document_id == source_id)
            .order_by(SourceChapter.chapter_number, SourceChapter.id)
        ).all()
        if not rows:
            raise SourceRepositoryError("SOURCE_NO_CHAPTERS", "来源资料至少需要一个章节才能拆集", status_code=422)
        content = "\n\n".join(
            f"{str(row.title).strip()}\n{str(row.content)}" for row in rows
        ).strip()
        if not content:
            raise SourceRepositoryError("SOURCE_NO_CONTENT", "来源资料没有可拆分的正文", status_code=422)
        content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
        return source, content, content_sha256

    def get_source_episode_split_input(
        self, workspace_id: str, source_id: str
    ) -> tuple[dict[str, Any], str, str]:
        with self.engine.connect() as connection:
            return self._source_split_content(connection, source_id, workspace_id)

    @staticmethod
    def _episode_payload(row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "id": str(row["id"]),
            "project_id": str(row["project_id"]),
            "title": str(row["title"]),
            "episode_number": row["episode_number"],
            "status": str(row["status"]),
            "linked_at": float(row["linked_at"]),
        }

    def create_document(
        self,
        *,
        workspace_id: str,
        title: str,
        source_type: str,
        original_filename: str | None,
        encoding: str,
        summary: str,
        metadata: Mapping[str, Any] | None,
        now: float | None = None,
    ) -> dict[str, Any]:
        workspace_id = self._id(workspace_id, "workspace_id")
        title = str(title).strip()
        if not title:
            raise SourceRepositoryError("SOURCE_INVALID_INPUT", "来源资料标题不能为空", status_code=422)
        timestamp = time.time() if now is None else float(now)
        source_id = str(uuid.uuid4())
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                connection.execute(
                    SourceDocument.__table__.insert().values(
                        id=source_id,
                        workspace_id=workspace_id,
                        title=title,
                        source_type=source_type,
                        original_filename=original_filename,
                        encoding=encoding,
                        summary=summary,
                        metadata_json=_json(metadata),
                        created_at=timestamp,
                        updated_at=timestamp,
                    )
                )
                row = connection.execute(
                    select(SourceDocument.__table__).where(SourceDocument.id == source_id)
                ).mappings().one()
        return self._document_payload(row, 0, 0) | {"chapters": [], "episodes": []}

    @staticmethod
    def _preview_payload(row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "id": str(row["id"]),
            "workspace_id": str(row["workspace_id"]),
            "source_type": str(row["source_type"]),
            "title": str(row["title"]),
            "original_filename": row["original_filename"],
            "encoding": str(row["encoding"]),
            "content": str(row["content"]),
            "summary": str(row["summary"]),
            "content_sha256": str(row["content_sha256"]),
            "proposals": json.loads(str(row["proposals_json"])),
            "status": str(row["status"]),
            "source_document_id": row["source_document_id"],
            "created_at": float(row["created_at"]),
            "updated_at": float(row["updated_at"]),
        }

    def create_import_preview(
        self,
        *,
        workspace_id: str,
        source_type: str,
        title: str,
        original_filename: str | None,
        encoding: str,
        content: str,
        summary: str,
        proposals: list[Mapping[str, Any]],
        user_id: str | None,
        content_sha256: str,
        now: float | None = None,
    ) -> dict[str, Any]:
        workspace_id = self._id(workspace_id, "workspace_id")
        title = str(title).strip()
        content = str(content)
        if not title or not content.strip() or not proposals:
            raise SourceRepositoryError("SOURCE_IMPORT_INVALID_INPUT", "导入标题、正文和章节提案不能为空", status_code=422)
        timestamp = time.time() if now is None else float(now)
        preview_id = str(uuid.uuid4())
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                connection.execute(
                    SourceImportPreview.__table__.insert().values(
                        id=preview_id,
                        workspace_id=workspace_id,
                        source_type=source_type,
                        title=title,
                        original_filename=original_filename,
                        encoding=encoding,
                        content=content,
                        content_sha256=content_sha256,
                        summary=summary,
                        proposals_json=json.dumps(proposals, ensure_ascii=False, separators=(",", ":")),
                        status="previewing",
                        source_document_id=None,
                        created_by_user_id=user_id,
                        created_at=timestamp,
                        updated_at=timestamp,
                    )
                )
                row = connection.execute(
                    select(SourceImportPreview.__table__).where(SourceImportPreview.id == preview_id)
                ).mappings().one()
        return self._preview_payload(row)

    def create_episode_split_preview(
        self,
        *,
        workspace_id: str,
        source_id: str,
        suggested_episodes: int,
        proposals: list[Mapping[str, Any]],
        user_id: str | None,
        now: float | None = None,
    ) -> dict[str, Any]:
        timestamp = time.time() if now is None else float(now)
        if suggested_episodes < 1 or suggested_episodes > 50:
            raise SourceRepositoryError("SOURCE_INVALID_EPISODE_COUNT", "建议集数应在 1-50 之间", status_code=422)
        if not proposals:
            raise SourceRepositoryError("SOURCE_AI_SPLIT_EMPTY", "AI 未返回有效的分集提案", status_code=502)
        preview_id = str(uuid.uuid4())
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                source, content, content_sha256 = self._source_split_content(
                    connection, source_id, workspace_id
                )
                connection.execute(
                    SourceEpisodeSplitPreview.__table__.insert().values(
                        id=preview_id,
                        workspace_id=workspace_id,
                        source_document_id=source_id,
                        title=str(source["title"]),
                        content=content,
                        content_sha256=content_sha256,
                        suggested_episodes=suggested_episodes,
                        proposals_json=json.dumps(proposals, ensure_ascii=False, separators=(",", ":")),
                        status="previewing",
                        series_id=None,
                        episode_ids_json="[]",
                        created_by_user_id=user_id,
                        created_at=timestamp,
                        updated_at=timestamp,
                    )
                )
                row = connection.execute(
                    select(SourceEpisodeSplitPreview.__table__).where(
                        SourceEpisodeSplitPreview.id == preview_id
                    )
                ).mappings().one()
        return self._episode_split_preview_payload(row)

    def get_episode_split_preview(self, workspace_id: str, preview_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            return self._episode_split_preview_payload(
                self._episode_split_preview_row(connection, preview_id, workspace_id)
            )

    def workspace_for_episode_split_preview(self, preview_id: str) -> str | None:
        if not isinstance(preview_id, str) or not preview_id.strip():
            return None
        with self.engine.connect() as connection:
            row = connection.execute(
                select(SourceEpisodeSplitPreview.workspace_id).where(
                    SourceEpisodeSplitPreview.id == preview_id
                )
            ).first()
        return str(row[0]) if row else None

    def get_episode_split_preview_input(
        self, workspace_id: str, preview_id: str
    ) -> tuple[dict[str, Any], str]:
        with self.engine.connect() as connection:
            row = self._episode_split_preview_row(connection, preview_id, workspace_id)
            return self._episode_split_preview_payload(row), str(row["content"])

    def assert_episode_split_preview_source_current(
        self, workspace_id: str, preview_id: str
    ) -> None:
        """Reject confirmation before any Series/Episode write when source changed."""
        with self.engine.connect() as connection:
            row = self._episode_split_preview_row(connection, preview_id, workspace_id)
            _, _, current_sha256 = self._source_split_content(
                connection, str(row["source_document_id"]), workspace_id
            )
            if current_sha256 != row["content_sha256"]:
                raise SourceRepositoryError(
                    "SOURCE_EPISODE_SPLIT_SOURCE_CHANGED",
                    "来源正文在预览后发生变化，请重新生成拆集预览",
                    status_code=409,
                )

    def list_episode_split_episodes(
        self, workspace_id: str, series_id: str, episode_ids: list[str]
    ) -> list[dict[str, Any]]:
        if not episode_ids:
            return []
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(
                    Episode.id,
                    Episode.title,
                    Episode.episode_number,
                    func.length(Script.original_text).label("text_length"),
                )
                .join(Project, Project.id == Episode.project_id)
                .join(Script, Script.episode_id == Episode.id)
                .where(
                    Project.workspace_id == self._id(workspace_id, "workspace_id"),
                    Episode.project_id == self._id(series_id, "series_id"),
                    Episode.id.in_([self._id(item, "episode_id") for item in episode_ids]),
                )
            ).mappings().all()
        by_id = {str(row["id"]): row for row in rows}
        if set(by_id) != set(episode_ids):
            raise SourceRepositoryError("EPISODE_NOT_FOUND", "剧集不存在", status_code=404)
        return [
            {
                "id": episode_id,
                "title": str(by_id[episode_id]["title"]),
                "episode_number": int(by_id[episode_id]["episode_number"]),
                "text_length": int(by_id[episode_id]["text_length"] or 0),
            }
            for episode_id in episode_ids
        ]

    def update_episode_split_preview(
        self,
        *,
        workspace_id: str,
        preview_id: str,
        proposals: list[Mapping[str, Any]],
        now: float | None = None,
    ) -> dict[str, Any]:
        if not proposals:
            raise SourceRepositoryError("SOURCE_AI_SPLIT_EMPTY", "至少需要一个分集提案", status_code=422)
        timestamp = time.time() if now is None else float(now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                row = self._episode_split_preview_row(connection, preview_id, workspace_id)
                if row["status"] != "previewing":
                    raise SourceRepositoryError("SOURCE_EPISODE_SPLIT_PREVIEW_CLOSED", "该拆集预览已关闭，不能修改", status_code=409)
                connection.execute(
                    update(SourceEpisodeSplitPreview)
                    .where(SourceEpisodeSplitPreview.id == preview_id)
                    .values(
                        proposals_json=json.dumps(proposals, ensure_ascii=False, separators=(",", ":")),
                        updated_at=timestamp,
                    )
                )
                updated = connection.execute(
                    select(SourceEpisodeSplitPreview.__table__).where(
                        SourceEpisodeSplitPreview.id == preview_id
                    )
                ).mappings().one()
        return self._episode_split_preview_payload(updated)

    def cancel_episode_split_preview(
        self, *, workspace_id: str, preview_id: str, now: float | None = None
    ) -> dict[str, Any]:
        timestamp = time.time() if now is None else float(now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                row = self._episode_split_preview_row(connection, preview_id, workspace_id)
                if row["status"] == "confirmed":
                    raise SourceRepositoryError("SOURCE_EPISODE_SPLIT_PREVIEW_CLOSED", "已确认的拆集预览不能取消", status_code=409)
                connection.execute(
                    update(SourceEpisodeSplitPreview)
                    .where(SourceEpisodeSplitPreview.id == preview_id)
                    .values(status="canceled", updated_at=timestamp)
                )
                canceled = connection.execute(
                    select(SourceEpisodeSplitPreview.__table__).where(
                        SourceEpisodeSplitPreview.id == preview_id
                    )
                ).mappings().one()
        return self._episode_split_preview_payload(canceled)

    def confirm_episode_split_preview(
        self,
        *,
        workspace_id: str,
        preview_id: str,
        series_id: str,
        episode_ids: list[str],
        now: float | None = None,
    ) -> dict[str, Any]:
        if not episode_ids:
            raise SourceRepositoryError("SOURCE_AI_SPLIT_EMPTY", "没有可绑定的剧集", status_code=422)
        timestamp = time.time() if now is None else float(now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                row = self._episode_split_preview_row(connection, preview_id, workspace_id)
                if row["status"] == "canceled":
                    raise SourceRepositoryError("SOURCE_EPISODE_SPLIT_PREVIEW_CANCELED", "拆集预览已取消，不能确认", status_code=409)
                if row["status"] == "confirmed":
                    return self._episode_split_preview_payload(row)
                source, _, current_sha256 = self._source_split_content(
                    connection, str(row["source_document_id"]), workspace_id
                )
                if current_sha256 != row["content_sha256"]:
                    raise SourceRepositoryError(
                        "SOURCE_EPISODE_SPLIT_SOURCE_CHANGED",
                        "来源正文在预览后发生变化，请重新生成拆集预览",
                        status_code=409,
                    )
                valid_series = connection.execute(
                    select(Series.id)
                    .join(Project, Project.id == Series.project_id)
                    .where(
                        Series.id == self._id(series_id, "series_id"),
                        Project.workspace_id == self._id(workspace_id, "workspace_id"),
                    )
                ).scalar_one_or_none()
                if valid_series is None:
                    raise SourceRepositoryError("SERIES_NOT_FOUND", "目标剧集不存在", status_code=404)
                valid_ids = set(
                    connection.execute(
                        select(Episode.id)
                        .join(Project, Project.id == Episode.project_id)
                        .where(
                            Episode.id.in_([self._id(item, "episode_id") for item in episode_ids]),
                            Episode.project_id == series_id,
                            Project.workspace_id == workspace_id,
                        )
                    ).scalars().all()
                )
                if valid_ids != set(episode_ids):
                    raise SourceRepositoryError("EPISODE_NOT_FOUND", "确认结果中包含不存在或无权访问的剧集", status_code=404)
                for episode_id in episode_ids:
                    connection.execute(
                        insert(SourceEpisodeLink)
                        .values(
                            source_document_id=row["source_document_id"],
                            episode_id=episode_id,
                            created_by_user_id=row["created_by_user_id"],
                            created_at=timestamp,
                        )
                        .prefix_with("OR IGNORE")
                    )
                connection.execute(
                    update(SourceEpisodeSplitPreview)
                    .where(SourceEpisodeSplitPreview.id == preview_id)
                    .values(
                        status="confirmed",
                        series_id=series_id,
                        episode_ids_json=json.dumps(episode_ids, ensure_ascii=False, separators=(",", ":")),
                        updated_at=timestamp,
                    )
                )
                connection.execute(
                    update(SourceDocument)
                    .where(SourceDocument.id == row["source_document_id"])
                    .values(updated_at=timestamp)
                )
                confirmed = connection.execute(
                    select(SourceEpisodeSplitPreview.__table__).where(
                        SourceEpisodeSplitPreview.id == preview_id
                    )
                ).mappings().one()
                return self._episode_split_preview_payload(confirmed)

    def get_import_preview(self, workspace_id: str, preview_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            return self._preview_payload(self._preview_row(connection, preview_id, workspace_id))

    def get_import_preview_content(self, workspace_id: str, preview_id: str) -> str:
        with self.engine.connect() as connection:
            return str(self._preview_row(connection, preview_id, workspace_id)["content"])

    def workspace_for_import_preview(self, preview_id: str) -> str | None:
        if not isinstance(preview_id, str) or not preview_id.strip():
            return None
        with self.engine.connect() as connection:
            row = connection.execute(
                select(SourceImportPreview.workspace_id).where(SourceImportPreview.id == preview_id)
            ).first()
        return str(row[0]) if row else None

    def update_import_preview_boundaries(
        self,
        *,
        workspace_id: str,
        preview_id: str,
        proposals: list[Mapping[str, Any]],
        now: float | None = None,
    ) -> dict[str, Any]:
        timestamp = time.time() if now is None else float(now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                row = self._preview_row(connection, preview_id, workspace_id)
                if row["status"] != "previewing":
                    raise SourceRepositoryError("SOURCE_IMPORT_PREVIEW_CLOSED", "该导入预览已关闭，不能修正边界", status_code=409)
                connection.execute(
                    update(SourceImportPreview)
                    .where(SourceImportPreview.id == preview_id)
                    .values(
                        proposals_json=json.dumps(proposals, ensure_ascii=False, separators=(",", ":")),
                        updated_at=timestamp,
                    )
                )
                updated = connection.execute(
                    select(SourceImportPreview.__table__).where(SourceImportPreview.id == preview_id)
                ).mappings().one()
        return self._preview_payload(updated)

    def cancel_import_preview(
        self, *, workspace_id: str, preview_id: str, now: float | None = None
    ) -> dict[str, Any]:
        timestamp = time.time() if now is None else float(now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                row = self._preview_row(connection, preview_id, workspace_id)
                if row["status"] == "confirmed":
                    raise SourceRepositoryError("SOURCE_IMPORT_PREVIEW_CLOSED", "已确认的导入不能取消", status_code=409)
                if row["status"] == "previewing":
                    connection.execute(
                        update(SourceImportPreview)
                        .where(SourceImportPreview.id == preview_id)
                        .values(status="canceled", updated_at=timestamp)
                    )
                canceled = connection.execute(
                    select(SourceImportPreview.__table__).where(SourceImportPreview.id == preview_id)
                ).mappings().one()
        return self._preview_payload(canceled)

    def confirm_import_preview(
        self, *, workspace_id: str, preview_id: str, user_id: str | None, now: float | None = None
    ) -> dict[str, Any]:
        timestamp = time.time() if now is None else float(now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                row = self._preview_row(connection, preview_id, workspace_id)
                if row["status"] == "canceled":
                    raise SourceRepositoryError("SOURCE_IMPORT_PREVIEW_CANCELED", "导入预览已取消，不能确认", status_code=409)
                if row["status"] == "confirmed" and row["source_document_id"]:
                    source_row = self._source_row(connection, str(row["source_document_id"]), workspace_id)
                    chapters = connection.execute(
                        select(SourceChapter.__table__).where(SourceChapter.source_document_id == source_row["id"])
                        .order_by(SourceChapter.chapter_number, SourceChapter.id)
                    ).mappings().all()
                    return self._document_payload(
                        source_row,
                        len(chapters),
                        connection.execute(select(func.count()).select_from(SourceEpisodeLink).where(SourceEpisodeLink.source_document_id == source_row["id"])).scalar_one(),
                    ) | {"chapters": [self._chapter_payload(connection, chapter) for chapter in chapters], "episodes": []}

                proposals = json.loads(str(row["proposals_json"]))
                if not isinstance(proposals, list) or not proposals:
                    raise SourceRepositoryError("SOURCE_IMPORT_NO_CHAPTERS", "至少需要一个章节提案", status_code=422)
                source_id = str(uuid.uuid4())
                connection.execute(
                    SourceDocument.__table__.insert().values(
                        id=source_id,
                        workspace_id=workspace_id,
                        title=row["title"],
                        source_type=row["source_type"],
                        original_filename=row["original_filename"],
                        encoding=row["encoding"],
                        summary=row["summary"],
                        metadata_json=_json({
                            "imported_at": timestamp,
                            "content_sha256": row["content_sha256"],
                            "import_preview_id": preview_id,
                        }),
                        created_at=timestamp,
                        updated_at=timestamp,
                    )
                )
                for chapter_number, proposal in enumerate(proposals, start=1):
                    if not isinstance(proposal, Mapping):
                        raise SourceRepositoryError("SOURCE_IMPORT_BOUNDARY_INVALID", "章节提案格式无效", status_code=422)
                    title = str(proposal.get("title") or f"第 {chapter_number} 章").strip()
                    content = str(proposal.get("content") or "").strip()
                    if not title or not content:
                        raise SourceRepositoryError("SOURCE_IMPORT_BOUNDARY_INVALID", "章节标题和正文不能为空", status_code=422)
                    chapter_id = str(uuid.uuid4())
                    revision_id = str(uuid.uuid4())
                    connection.execute(
                        SourceChapter.__table__.insert().values(
                            id=chapter_id,
                            source_document_id=source_id,
                            chapter_number=chapter_number,
                            title=title,
                            current_revision_id=None,
                            created_at=timestamp,
                            updated_at=timestamp,
                        )
                    )
                    connection.execute(
                        SourceRevision.__table__.insert().values(
                            id=revision_id,
                            source_document_id=source_id,
                            chapter_id=chapter_id,
                            revision_number=1,
                            content=content,
                            content_sha256=hashlib.sha256(content.encode("utf-8")).hexdigest(),
                            created_by_user_id=user_id,
                            metadata_json=_json({"import_preview_id": preview_id, "volume": proposal.get("volume", "")}),
                            created_at=timestamp,
                        )
                    )
                    connection.execute(
                        update(SourceChapter)
                        .where(SourceChapter.id == chapter_id)
                        .values(current_revision_id=revision_id)
                    )
                connection.execute(
                    update(SourceImportPreview)
                    .where(SourceImportPreview.id == preview_id)
                    .values(status="confirmed", source_document_id=source_id, updated_at=timestamp)
                )
                source_row = connection.execute(
                    select(SourceDocument.__table__).where(SourceDocument.id == source_id)
                ).mappings().one()
                chapters = connection.execute(
                    select(SourceChapter.__table__).where(SourceChapter.source_document_id == source_id)
                    .order_by(SourceChapter.chapter_number, SourceChapter.id)
                ).mappings().all()
                return self._document_payload(source_row, len(chapters), 0) | {
                    "chapters": [self._chapter_payload(connection, chapter) for chapter in chapters],
                    "episodes": [],
                }

    def list_documents(self, workspace_id: str) -> list[dict[str, Any]]:
        workspace_id = self._id(workspace_id, "workspace_id")
        chapter_count = (
            select(func.count(SourceChapter.id))
            .where(SourceChapter.source_document_id == SourceDocument.id)
            .scalar_subquery()
        )
        episode_count = (
            select(func.count(SourceEpisodeLink.episode_id))
            .where(SourceEpisodeLink.source_document_id == SourceDocument.id)
            .scalar_subquery()
        )
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(SourceDocument.__table__, chapter_count.label("chapter_count"), episode_count.label("episode_count"))
                .where(SourceDocument.workspace_id == workspace_id)
                .order_by(SourceDocument.updated_at.desc(), SourceDocument.id)
            ).mappings().all()
        return [self._document_payload(row, row["chapter_count"], row["episode_count"]) for row in rows]

    def get_document(self, workspace_id: str, source_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = self._source_row(connection, source_id, workspace_id)
            chapters = connection.execute(
                select(SourceChapter.__table__)
                .where(SourceChapter.source_document_id == source_id)
                .order_by(SourceChapter.chapter_number, SourceChapter.id)
            ).mappings().all()
            episodes = connection.execute(
                select(Episode.__table__, SourceEpisodeLink.created_at.label("linked_at"))
                .join(SourceEpisodeLink, SourceEpisodeLink.episode_id == Episode.id)
                .where(SourceEpisodeLink.source_document_id == source_id)
                .order_by(Episode.episode_number, Episode.id)
            ).mappings().all()
            document = self._document_payload(
                row,
                len(chapters),
                len(episodes),
            )
            document["chapters"] = [self._chapter_payload(connection, item) for item in chapters]
            document["episodes"] = [self._episode_payload(item) for item in episodes]
            return document

    def list_chapters_page(
        self,
        workspace_id: str,
        source_id: str,
        *,
        query: str = "",
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, Any]:
        workspace_id = self._id(workspace_id, "workspace_id")
        source_id = self._id(source_id, "source_id")
        page = int(page)
        page_size = int(page_size)
        if page < 1 or page_size < 1 or page_size > 100:
            raise SourceRepositoryError("SOURCE_INVALID_PAGINATION", "分页参数不合法", status_code=422)
        normalized_query = str(query or "").strip()
        if len(normalized_query) > 200:
            raise SourceRepositoryError("SOURCE_SEARCH_TOO_LONG", "搜索关键词不能超过 200 个字符", status_code=422)
        with self.engine.connect() as connection:
            self._source_row(connection, source_id, workspace_id)
            conditions = [SourceChapter.source_document_id == source_id]
            if normalized_query:
                pattern = f"%{normalized_query}%"
                current_content = exists(
                    select(SourceRevision.id).where(
                        SourceRevision.id == SourceChapter.current_revision_id,
                        SourceRevision.content.ilike(pattern),
                    )
                )
                conditions.append(or_(SourceChapter.title.ilike(pattern), current_content))
            total = int(
                connection.execute(
                    select(func.count()).select_from(SourceChapter).where(and_(*conditions))
                ).scalar_one()
            )
            rows = connection.execute(
                select(SourceChapter.__table__)
                .where(and_(*conditions))
                .order_by(SourceChapter.chapter_number, SourceChapter.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).mappings().all()
            return {
                "items": [self._chapter_payload(connection, row) for row in rows],
                "total": total,
                "page": page,
                "page_size": page_size,
            }

    def list_chapters(self, workspace_id: str, source_id: str) -> list[dict[str, Any]]:
        """Backward-compatible unpaged chapter listing for repository callers."""
        workspace_id = self._id(workspace_id, "workspace_id")
        source_id = self._id(source_id, "source_id")
        with self.engine.connect() as connection:
            self._source_row(connection, source_id, workspace_id)
            rows = connection.execute(
                select(SourceChapter.__table__)
                .where(SourceChapter.source_document_id == source_id)
                .order_by(SourceChapter.chapter_number, SourceChapter.id)
            ).mappings().all()
            return [self._chapter_payload(connection, row) for row in rows]

    def update_chapter(
        self,
        *,
        workspace_id: str,
        source_id: str,
        chapter_id: str,
        title: str | None,
        content: str | None,
        user_id: str | None,
        now: float | None = None,
    ) -> dict[str, Any]:
        if title is None and content is None:
            raise SourceRepositoryError("SOURCE_INVALID_INPUT", "至少需要修改标题或正文", status_code=422)
        normalized_title = str(title).strip() if title is not None else None
        normalized_content = str(content) if content is not None else None
        if normalized_title is not None and not normalized_title:
            raise SourceRepositoryError("SOURCE_INVALID_INPUT", "章节标题不能为空", status_code=422)
        if normalized_content is not None and not normalized_content.strip():
            raise SourceRepositoryError("SOURCE_INVALID_INPUT", "章节正文不能为空", status_code=422)
        timestamp = time.time() if now is None else float(now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                chapter = self._chapter_row(connection, source_id, chapter_id, workspace_id)
                values: dict[str, Any] = {"updated_at": timestamp}
                if normalized_title is not None:
                    values["title"] = normalized_title
                connection.execute(
                    update(SourceChapter).where(SourceChapter.id == chapter_id).values(**values)
                )
                if normalized_content is not None:
                    revision_id = str(uuid.uuid4())
                    revision_number = int(
                        connection.execute(
                            select(func.coalesce(func.max(SourceRevision.revision_number), 0)).where(
                                SourceRevision.chapter_id == chapter_id
                            )
                        ).scalar_one()
                    ) + 1
                    connection.execute(
                        SourceRevision.__table__.insert().values(
                            id=revision_id,
                            source_document_id=source_id,
                            chapter_id=chapter_id,
                            revision_number=revision_number,
                            content=normalized_content,
                            content_sha256=hashlib.sha256(normalized_content.encode("utf-8")).hexdigest(),
                            created_by_user_id=user_id,
                            metadata_json=_json({"edit_type": "chapter_edit"}),
                            created_at=timestamp,
                        )
                    )
                    connection.execute(
                        update(SourceChapter)
                        .where(SourceChapter.id == chapter_id)
                        .values(current_revision_id=revision_id)
                    )
                connection.execute(
                    update(SourceDocument).where(SourceDocument.id == source_id).values(updated_at=timestamp)
                )
                updated = connection.execute(
                    select(SourceChapter.__table__).where(SourceChapter.id == chapter_id)
                ).mappings().one()
                return self._chapter_payload(connection, updated)

    def restore_revision(
        self,
        *,
        workspace_id: str,
        source_id: str,
        chapter_id: str,
        revision_id: str,
        user_id: str | None,
        now: float | None = None,
    ) -> dict[str, Any]:
        timestamp = time.time() if now is None else float(now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                self._chapter_row(connection, source_id, chapter_id, workspace_id)
                target = connection.execute(
                    select(SourceRevision.__table__).where(
                        SourceRevision.id == self._id(revision_id, "revision_id"),
                        SourceRevision.source_document_id == source_id,
                        SourceRevision.chapter_id == chapter_id,
                    )
                ).mappings().first()
                if target is None:
                    raise SourceRepositoryError("SOURCE_REVISION_NOT_FOUND", "来源版本不存在", status_code=404)
                revision_number = int(
                    connection.execute(
                        select(func.coalesce(func.max(SourceRevision.revision_number), 0)).where(
                            SourceRevision.chapter_id == chapter_id
                        )
                    ).scalar_one()
                ) + 1
                new_revision_id = str(uuid.uuid4())
                connection.execute(
                    SourceRevision.__table__.insert().values(
                        id=new_revision_id,
                        source_document_id=source_id,
                        chapter_id=chapter_id,
                        revision_number=revision_number,
                        content=target["content"],
                        content_sha256=target["content_sha256"],
                        created_by_user_id=user_id,
                        metadata_json=_json({
                            "edit_type": "revision_restore",
                            "restored_from_revision_id": revision_id,
                            "restored_from_revision_number": target["revision_number"],
                        }),
                        created_at=timestamp,
                    )
                )
                connection.execute(
                    update(SourceChapter)
                    .where(SourceChapter.id == chapter_id)
                    .values(current_revision_id=new_revision_id, updated_at=timestamp)
                )
                connection.execute(
                    update(SourceDocument).where(SourceDocument.id == source_id).values(updated_at=timestamp)
                )
                row = connection.execute(
                    select(SourceRevision.__table__).where(SourceRevision.id == new_revision_id)
                ).mappings().one()
                return self._revision_payload(row)

    def create_chapter(
        self,
        *,
        workspace_id: str,
        source_id: str,
        chapter_number: int,
        title: str,
        content: str,
        metadata: Mapping[str, Any] | None,
        user_id: str | None,
        now: float | None = None,
    ) -> dict[str, Any]:
        timestamp = time.time() if now is None else float(now)
        title = str(title).strip()
        if not title or not str(content).strip():
            raise SourceRepositoryError("SOURCE_INVALID_INPUT", "章节标题和正文不能为空", status_code=422)
        content = str(content)
        chapter_id = str(uuid.uuid4())
        revision_id = str(uuid.uuid4())
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                self._source_row(connection, source_id, workspace_id)
                duplicate = connection.execute(
                    select(SourceChapter.id).where(
                        SourceChapter.source_document_id == source_id,
                        SourceChapter.chapter_number == chapter_number,
                    )
                ).scalar_one_or_none()
                if duplicate is not None:
                    raise SourceRepositoryError("SOURCE_CHAPTER_CONFLICT", "章节序号已存在", status_code=409)
                connection.execute(
                    SourceChapter.__table__.insert().values(
                        id=chapter_id,
                        source_document_id=source_id,
                        chapter_number=chapter_number,
                        title=title,
                        current_revision_id=None,
                        created_at=timestamp,
                        updated_at=timestamp,
                    )
                )
                connection.execute(
                    SourceRevision.__table__.insert().values(
                        id=revision_id,
                        source_document_id=source_id,
                        chapter_id=chapter_id,
                        revision_number=1,
                        content=content,
                        content_sha256=digest,
                        created_by_user_id=user_id,
                        metadata_json=_json(metadata),
                        created_at=timestamp,
                    )
                )
                connection.execute(
                    update(SourceChapter)
                    .where(SourceChapter.id == chapter_id)
                    .values(current_revision_id=revision_id)
                )
                connection.execute(
                    update(SourceDocument).where(SourceDocument.id == source_id).values(updated_at=timestamp)
                )
                row = connection.execute(
                    select(SourceChapter.__table__).where(SourceChapter.id == chapter_id)
                ).mappings().one()
                return self._chapter_payload(connection, row)

    def get_chapter(self, workspace_id: str, source_id: str, chapter_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = self._chapter_row(connection, source_id, chapter_id, workspace_id)
            return self._chapter_payload(connection, row)

    def list_revisions(self, workspace_id: str, source_id: str, chapter_id: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            self._chapter_row(connection, source_id, chapter_id, workspace_id)
            rows = connection.execute(
                select(SourceRevision.__table__)
                .where(SourceRevision.chapter_id == chapter_id)
                .order_by(SourceRevision.revision_number.desc())
            ).mappings().all()
            return [self._revision_payload(row) for row in rows]

    def create_revision(
        self,
        *,
        workspace_id: str,
        source_id: str,
        chapter_id: str,
        content: str,
        metadata: Mapping[str, Any] | None,
        user_id: str | None,
        now: float | None = None,
    ) -> dict[str, Any]:
        timestamp = time.time() if now is None else float(now)
        revision_id = str(uuid.uuid4())
        if not str(content).strip():
            raise SourceRepositoryError("SOURCE_INVALID_INPUT", "章节正文不能为空", status_code=422)
        content = str(content)
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                self._chapter_row(connection, source_id, chapter_id, workspace_id)
                revision_number = int(
                    connection.execute(
                        select(func.coalesce(func.max(SourceRevision.revision_number), 0)).where(
                            SourceRevision.chapter_id == chapter_id
                        )
                    ).scalar_one()
                ) + 1
                connection.execute(
                    SourceRevision.__table__.insert().values(
                        id=revision_id,
                        source_document_id=source_id,
                        chapter_id=chapter_id,
                        revision_number=revision_number,
                        content=content,
                        content_sha256=digest,
                        created_by_user_id=user_id,
                        metadata_json=_json(metadata),
                        created_at=timestamp,
                    )
                )
                connection.execute(
                    update(SourceChapter)
                    .where(SourceChapter.id == chapter_id)
                    .values(current_revision_id=revision_id, updated_at=timestamp)
                )
                connection.execute(
                    update(SourceDocument).where(SourceDocument.id == source_id).values(updated_at=timestamp)
                )
                row = connection.execute(
                    select(SourceRevision.__table__).where(SourceRevision.id == revision_id)
                ).mappings().one()
                return self._revision_payload(row)

    def list_episodes(self, workspace_id: str, source_id: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            self._source_row(connection, source_id, workspace_id)
            rows = connection.execute(
                select(Episode.__table__, SourceEpisodeLink.created_at.label("linked_at"))
                .join(SourceEpisodeLink, SourceEpisodeLink.episode_id == Episode.id)
                .join(Project, Project.id == Episode.project_id)
                .where(
                    SourceEpisodeLink.source_document_id == source_id,
                    Project.workspace_id == workspace_id,
                )
                .order_by(Episode.episode_number, Episode.id)
            ).mappings().all()
            return [self._episode_payload(row) for row in rows]

    def list_sources_for_episode(self, workspace_id: str, episode_id: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            self._episode_row(connection, episode_id, workspace_id)
            rows = connection.execute(
                select(SourceDocument.__table__)
                .join(SourceEpisodeLink, SourceEpisodeLink.source_document_id == SourceDocument.id)
                .where(SourceEpisodeLink.episode_id == episode_id)
                .where(SourceDocument.workspace_id == workspace_id)
                .order_by(SourceDocument.updated_at.desc(), SourceDocument.id)
            ).mappings().all()
            return [
                self._document_payload(
                    row,
                    connection.execute(
                        select(func.count()).select_from(SourceChapter).where(
                            SourceChapter.source_document_id == row["id"]
                        )
                    ).scalar_one(),
                    connection.execute(
                        select(func.count()).select_from(SourceEpisodeLink).where(
                            SourceEpisodeLink.source_document_id == row["id"]
                        )
                    ).scalar_one(),
                )
                for row in rows
            ]

    @staticmethod
    def _episode_row(connection, episode_id: str, workspace_id: str):
        row = connection.execute(
            select(Episode.__table__)
            .join(Project, Project.id == Episode.project_id)
            .where(Episode.id == episode_id, Project.workspace_id == workspace_id)
        ).mappings().first()
        if row is None:
            raise SourceRepositoryError("EPISODE_NOT_FOUND", "剧集不存在", status_code=404)
        return row

    def link_episode(
        self,
        *,
        workspace_id: str,
        source_id: str,
        episode_id: str,
        user_id: str | None,
        now: float | None = None,
    ) -> dict[str, Any]:
        timestamp = time.time() if now is None else float(now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                self._source_row(connection, source_id, workspace_id)
                self._episode_row(connection, episode_id, workspace_id)
                result = connection.execute(
                    insert(SourceEpisodeLink)
                    .values(
                        source_document_id=source_id,
                        episode_id=episode_id,
                        created_by_user_id=user_id,
                        created_at=timestamp,
                    )
                    .prefix_with("OR IGNORE")
                )
                connection.execute(
                    update(SourceDocument).where(SourceDocument.id == source_id).values(updated_at=timestamp)
                )
        return {
            "source_document_id": source_id,
            "episode_id": episode_id,
            "created": result.rowcount == 1,
            "linked": True,
        }

    def unlink_episode(self, *, workspace_id: str, source_id: str, episode_id: str) -> bool:
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                self._source_row(connection, source_id, workspace_id)
                self._episode_row(connection, episode_id, workspace_id)
                result = connection.execute(
                    delete(SourceEpisodeLink).where(
                        SourceEpisodeLink.source_document_id == source_id,
                        SourceEpisodeLink.episode_id == episode_id,
                    )
                )
                if result.rowcount:
                    connection.execute(
                        update(SourceDocument)
                        .where(SourceDocument.id == source_id)
                        .values(updated_at=time.time())
                    )
        return result.rowcount == 1

    def workspace_for_source(self, source_id: str) -> str | None:
        with self.engine.connect() as connection:
            return connection.execute(
                select(SourceDocument.workspace_id).where(SourceDocument.id == source_id)
            ).scalar_one_or_none()

    def workspace_for_episode(self, episode_id: str) -> str | None:
        with self.engine.connect() as connection:
            return connection.execute(
                select(Project.workspace_id)
                .join(Episode, Episode.project_id == Project.id)
                .where(Episode.id == episode_id)
            ).scalar_one_or_none()


__all__ = ["SourceRepository", "SourceRepositoryError"]
