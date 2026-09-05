"""SQLAlchemy 2.x metadata for the initial Omni Studio SQLite schema.

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
    """Declarative base for all Omni Studio storage tables."""


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


class LegacyClaimBatch(Base):
    __tablename__ = "legacy_claim_batches"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    workspace_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("workspaces.id", ondelete="RESTRICT"),
        nullable=False,
    )
    source_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    source_manifest_json: Mapped[str] = mapped_column(Text, nullable=False)
    mapping_json: Mapped[str] = mapped_column(Text, nullable=False)
    project_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    series_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    media_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    conflict_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    status: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    completed_at: Mapped[float] = mapped_column(REAL, nullable=False)
    rolled_back_at: Mapped[float | None] = mapped_column(REAL, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('claimed', 'rolled_back')",
            name="ck_legacy_claim_batches_status",
        ),
        CheckConstraint("json_valid(source_manifest_json)", name="ck_legacy_claim_source_manifest"),
        CheckConstraint("json_valid(mapping_json)", name="ck_legacy_claim_mapping"),
        Index("ix_legacy_claim_workspace_created", "workspace_id", "created_at"),
        Index("ix_legacy_claim_source", "source_sha256", "status"),
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    username_normalized: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    email_normalized: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    metadata_json: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="{}",
    )

    __table_args__ = (
        UniqueConstraint("username_normalized", name="uq_users_username_normalized"),
        UniqueConstraint("email_normalized", name="uq_users_email_normalized"),
        CheckConstraint(
            "length(username_normalized) BETWEEN 3 AND 64",
            name="ck_users_username_length",
        ),
        CheckConstraint(
            "length(email_normalized) BETWEEN 3 AND 254",
            name="ck_users_email_length",
        ),
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
        UniqueConstraint("owner_user_id", "slug", name="uq_workspaces_owner_slug"),
        Index("ix_workspaces_owner_user_id", "owner_user_id"),
    )


class WorkspaceMembership(Base):
    __tablename__ = "workspace_memberships"

    workspace_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)
    invited_by_user_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    joined_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("role IN ('owner', 'member')", name="ck_workspace_memberships_role"),
        Index("ix_workspace_memberships_user", "user_id", "workspace_id"),
        Index("uq_workspace_memberships_owner", "workspace_id", unique=True, sqlite_where=(role == "owner")),
    )


class WorkspaceInvitation(Base):
    __tablename__ = "workspace_invitations"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    email_normalized: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    invited_by_user_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    expires_at: Mapped[float] = mapped_column(REAL, nullable=False)
    accepted_at: Mapped[float | None] = mapped_column(REAL, nullable=True)
    accepted_by_user_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    revoked_at: Mapped[float | None] = mapped_column(REAL, nullable=True)

    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_workspace_invitations_expiry"),
        Index("ix_workspace_invitations_workspace", "workspace_id", "created_at"),
        Index("ix_workspace_invitations_email", "email_normalized", "expires_at"),
    )


class WorkspaceProviderConfig(Base):
    __tablename__ = "workspace_provider_configs"

    workspace_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        primary_key=True,
    )
    config_json: Mapped[str] = mapped_column(Text, nullable=False, server_default="{}")
    updated_by_user_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("json_valid(config_json)", name="ck_workspace_provider_configs_json"),
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    refresh_token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    rotation_counter: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    expires_at: Mapped[float] = mapped_column(REAL, nullable=False)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    last_used_at: Mapped[float | None] = mapped_column(REAL, nullable=True)
    revoked_at: Mapped[float | None] = mapped_column(REAL, nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("refresh_token_hash", name="uq_sessions_refresh_token_hash"),
        CheckConstraint("rotation_counter >= 0", name="ck_sessions_rotation_nonnegative"),
        CheckConstraint("expires_at > created_at", name="ck_sessions_expiry_order"),
        CheckConstraint(
            "last_used_at IS NULL OR last_used_at >= created_at",
            name="ck_sessions_last_used_order",
        ),
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name="ck_sessions_revoked_order",
        ),
        Index("ix_sessions_user_revoked", "user_id", "revoked_at"),
        Index("ix_sessions_expires_at", "expires_at"),
    )


class AuditEvent(Base):
    """Workspace-scoped, append-only security and lifecycle audit record."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    actor_user_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    workspace_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    object_type: Mapped[str] = mapped_column(Text, nullable=False)
    object_id: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False, server_default="{}")
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("json_valid(metadata_json)", name="ck_audit_events_metadata_json"),
        Index("ix_audit_events_workspace_created", "workspace_id", "created_at"),
        Index("ix_audit_events_object", "object_type", "object_id", "created_at"),
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


class ScriptEditLease(Base):
    __tablename__ = "script_edit_leases"

    script_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("scripts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    workspace_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    holder_user_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    client_instance_id: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    acquired_at: Mapped[float] = mapped_column(REAL, nullable=False)
    heartbeat_at: Mapped[float] = mapped_column(REAL, nullable=False)
    expires_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("expires_at > heartbeat_at", name="ck_script_edit_leases_expiry"),
        Index("ix_script_edit_leases_expiry", "expires_at"),
        Index("ix_script_edit_leases_holder", "holder_user_id", "expires_at"),
    )


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    episode_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("episodes.id", ondelete="SET NULL"),
        nullable=True,
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False, server_default="{}")
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("json_valid(metadata_json)", name="ck_jobs_metadata_json"),
        Index("ix_jobs_workspace_updated", "workspace_id", "updated_at"),
        Index("ix_jobs_project_episode", "project_id", "episode_id", "updated_at"),
    )


class JobItem(Base):
    __tablename__ = "job_items"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    job_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    workspace_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    episode_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    progress: Mapped[float] = mapped_column(REAL, nullable=False, server_default="0")
    idempotency_key: Mapped[str] = mapped_column(Text, nullable=False)
    retry_of: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, server_default="{}")
    media_refs_json: Mapped[str] = mapped_column(Text, nullable=False, server_default="[]")
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    started_at: Mapped[float | None] = mapped_column(REAL, nullable=True)
    finished_at: Mapped[float | None] = mapped_column(REAL, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'processing', 'succeeded', 'failed', 'canceled', 'skipped')",
            name="ck_job_items_status",
        ),
        CheckConstraint("progress >= 0 AND progress <= 1", name="ck_job_items_progress"),
        CheckConstraint("json_valid(payload_json)", name="ck_job_items_payload_json"),
        CheckConstraint("json_valid(media_refs_json)", name="ck_job_items_media_refs_json"),
        UniqueConstraint("workspace_id", "idempotency_key", name="uq_job_items_workspace_idempotency"),
        Index("ix_job_items_job_status", "job_id", "status"),
        Index("ix_job_items_workspace_updated", "workspace_id", "updated_at"),
    )


class JobItemEvent(Base):
    __tablename__ = "job_item_events"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    item_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("job_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    to_status: Mapped[str] = mapped_column(Text, nullable=False)
    progress: Mapped[float | None] = mapped_column(REAL, nullable=True)
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        Index("ix_job_item_events_item_created", "item_id", "created_at"),
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
    "LegacyClaimBatch",
    "User",
    "Workspace",
    "WorkspaceMembership",
    "WorkspaceInvitation",
    "WorkspaceProviderConfig",
    "Session",
    "AuditEvent",
    "Project",
    "Series",
    "Episode",
    "Script",
    "ScriptEditLease",
    "Job",
    "JobItem",
    "JobItemEvent",
]
