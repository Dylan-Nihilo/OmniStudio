"""Workspace-scoped persistence for Source documents and their relationships."""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from typing import Any, Mapping

from sqlalchemy import func, insert, select, update
from sqlalchemy.engine import Engine

from .db import begin_immediate
from .schema import (
    Episode,
    Project,
    SourceChapter,
    SourceDocument,
    SourceEpisodeLink,
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

    @staticmethod
    def _document_payload(row: Mapping[str, Any], chapter_count: int, episode_count: int) -> dict[str, Any]:
        return {
            "id": str(row["id"]),
            "workspace_id": str(row["workspace_id"]),
            "title": str(row["title"]),
            "source_type": str(row["source_type"]),
            "original_filename": row["original_filename"],
            "encoding": str(row["encoding"]),
            "summary": str(row["summary"]),
            "metadata": _metadata(str(row["metadata_json"])),
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

    def list_chapters(self, workspace_id: str, source_id: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            self._source_row(connection, source_id, workspace_id)
            rows = connection.execute(
                select(SourceChapter.__table__)
                .where(SourceChapter.source_document_id == source_id)
                .order_by(SourceChapter.chapter_number, SourceChapter.id)
            ).mappings().all()
            return [self._chapter_payload(connection, row) for row in rows]

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
        from sqlalchemy import delete

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
