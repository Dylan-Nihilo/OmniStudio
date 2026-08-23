"""SQLAlchemy 2.x metadata for the initial LumenX SQLite schema.

The W1 storage layer intentionally keeps the existing Script and Series aggregates
in JSON payload columns.  The relational columns below are the stable identity,
relationship, and lifecycle envelope used by later repository work.
"""

from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    REAL,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base for all LumenX storage tables."""


class SchemaMigration(Base):
    __tablename__ = "schema_migrations"

    version: Mapped[str] = mapped_column(Text, primary_key=True)
    applied_at: Mapped[float] = mapped_column(REAL, nullable=False)
    checksum: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class MigrationRun(Base):
    __tablename__ = "migration_runs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    migration_name: Mapped[str] = mapped_column(Text, nullable=False)
    source_name: Mapped[str] = mapped_column(Text, nullable=False)
    source_path: Mapped[str] = mapped_column(Text, nullable=False)
    source_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(Text, nullable=False)
    rows_seen: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    rows_inserted: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    rows_updated: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    rows_skipped: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[float] = mapped_column(REAL, nullable=False)
    completed_at: Mapped[float | None] = mapped_column(REAL, nullable=True)

    __table_args__ = (
        CheckConstraint("mode IN ('dry_run', 'apply')", name="ck_migration_runs_mode"),
        CheckConstraint(
            "status IN ('started', 'completed', 'failed', 'skipped')",
            name="ck_migration_runs_status",
        ),
        Index(
            "uq_migration_runs_apply_source",
            "migration_name",
            "source_name",
            "source_sha256",
            "mode",
            unique=True,
        ),
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    email: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    metadata_json: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="{}",
    )

    __table_args__ = (
        CheckConstraint("json_valid(metadata_json)", name="ck_users_metadata_json"),
    )


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    owner_user_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    metadata_json: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="{}",
    )

    __table_args__ = (
        CheckConstraint("json_valid(metadata_json)", name="ck_workspaces_metadata_json"),
        UniqueConstraint("owner_user_id", "slug"),
        Index("ix_workspaces_owner_user_id", "owner_user_id"),
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    workspace_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    mode: Mapped[str] = mapped_column(Text, nullable=False, server_default="standalone")
    legacy_series_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    metadata_json: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="{}",
    )

    __table_args__ = (
        CheckConstraint("mode IN ('standalone', 'series')", name="ck_projects_mode"),
        CheckConstraint("json_valid(metadata_json)", name="ck_projects_metadata_json"),
        UniqueConstraint("workspace_id", "title"),
        Index("ix_projects_legacy_series_id", "legacy_series_id"),
        Index("ix_projects_mode", "mode"),
    )


class Series(Base):
    __tablename__ = "series"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    payload_schema_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default="1",
    )
    payload_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("json_valid(payload_json)", name="ck_series_payload_json"),
    )


class Episode(Base):
    __tablename__ = "episodes"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    series_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("series.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    episode_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="draft")
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    metadata_json: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="{}",
    )

    __table_args__ = (
        CheckConstraint("json_valid(metadata_json)", name="ck_episodes_metadata_json"),
        UniqueConstraint("project_id", "episode_number"),
        Index("ix_episodes_project_order", "project_id", "episode_number", "created_at"),
        Index("ix_episodes_series_order", "series_id", "episode_number"),
    )


class Script(Base):
    __tablename__ = "scripts"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    episode_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("episodes.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    original_text: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    payload_schema_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default="1",
    )
    payload_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("id = episode_id", name="ck_scripts_id_episode_id"),
        CheckConstraint("json_valid(payload_json)", name="ck_scripts_payload_json"),
        Index("ix_scripts_updated", "updated_at"),
        Index("ix_scripts_original_text_prefix", "id", "updated_at"),
    )


# Explicit DESC expressions preserve the ordering specified by the SQLite DDL.
Index(
    "ix_migration_runs_source",
    MigrationRun.__table__.c.source_name,
    MigrationRun.__table__.c.started_at.desc(),
)
Index(
    "ix_projects_workspace_updated",
    Project.__table__.c.workspace_id,
    Project.__table__.c.updated_at.desc(),
)
Index("ix_series_updated", Series.__table__.c.updated_at.desc())
Index("ix_episodes_updated", Episode.__table__.c.updated_at.desc())


__all__ = [
    "Base",
    "SchemaMigration",
    "MigrationRun",
    "User",
    "Workspace",
    "Project",
    "Series",
    "Episode",
    "Script",
]
