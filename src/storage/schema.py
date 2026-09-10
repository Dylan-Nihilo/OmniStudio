"""SQLAlchemy 2.x metadata for the initial Omni Studio SQLite schema.

The W1 storage layer intentionally keeps the existing Script and Series aggregates
in JSON payload columns.  The relational columns below are the stable identity,
relationship, and lifecycle envelope used by later repository work.
"""

from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    DDL,
    REAL,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
    text,
)
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Column type vocabulary shared by SQLite (desktop/local) and MySQL 8 (hosted).
# SQLite ignores VARCHAR lengths, so these only constrain MySQL, where TEXT columns
# cannot carry an index, a plain DEFAULT, or a foreign key.
KEY = String(64)       # uuid / short enum used as PK, FK, unique or indexed column
HASH = String(128)     # token/content hashes; production refresh-token hashes carry a scheme prefix (71 chars)
NAME = String(255)     # human-readable identifiers used in keys (titles, slugs, normalized emails)
LABEL = String(64)     # short status/role/mode values that carry a server default
BIG = Text().with_variant(LONGTEXT(), "mysql")   # JSON blobs and free text without a 64 KB ceiling


def text_default(value: str):
    """Server default usable on BIG columns: MySQL 8.0.13+ and SQLite both accept ``DEFAULT ('...')``."""
    return text("('" + value.replace("'", "''") + "')")


class Base(DeclarativeBase):
    """Declarative base for all Omni Studio storage tables."""


class SchemaMigration(Base):
    __tablename__ = "schema_migrations"

    version: Mapped[str] = mapped_column(KEY, primary_key=True)
    applied_at: Mapped[float] = mapped_column(REAL, nullable=False)
    checksum: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(BIG, nullable=False)


class MigrationRun(Base):
    __tablename__ = "migration_runs"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    migration_name: Mapped[str] = mapped_column(NAME, nullable=False)
    source_name: Mapped[str] = mapped_column(NAME, nullable=False)
    source_path: Mapped[str] = mapped_column(BIG, nullable=False)
    source_sha256: Mapped[str] = mapped_column(HASH, nullable=False)
    mode: Mapped[str] = mapped_column(
        KEY,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(Text, nullable=False)
    rows_seen: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    rows_inserted: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    rows_updated: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    rows_skipped: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    error_text: Mapped[str | None] = mapped_column(BIG, nullable=True)
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

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="RESTRICT"),
        nullable=False,
    )
    source_sha256: Mapped[str] = mapped_column(HASH, nullable=False)
    source_manifest_json: Mapped[str] = mapped_column(BIG, nullable=False)
    mapping_json: Mapped[str] = mapped_column(BIG, nullable=False)
    project_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    series_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    media_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    conflict_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    status: Mapped[str] = mapped_column(KEY, nullable=False)
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

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    username_normalized: Mapped[str] = mapped_column(NAME, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    email_normalized: Mapped[str] = mapped_column(NAME, nullable=False)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    metadata_json: Mapped[str] = mapped_column(
        BIG,
        nullable=False,
        server_default=text_default("{}"),
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

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    owner_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str | None] = mapped_column(NAME, nullable=True)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    metadata_json: Mapped[str] = mapped_column(
        BIG,
        nullable=False,
        server_default=text_default("{}"),
    )

    __table_args__ = (
        CheckConstraint("json_valid(metadata_json)", name="ck_workspaces_metadata_json"),
        UniqueConstraint("owner_user_id", "slug", name="uq_workspaces_owner_slug"),
        Index("ix_workspaces_owner_user_id", "owner_user_id"),
    )


class WorkspaceMembership(Base):
    __tablename__ = "workspace_memberships"

    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)
    access_role: Mapped[str] = mapped_column(LABEL, nullable=False, server_default="member")
    invited_by_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    joined_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("role IN ('owner', 'member')", name="ck_workspace_memberships_role"),
        Index("ix_workspace_memberships_user", "user_id", "workspace_id"),
    )


# One owner per workspace. SQLite expresses this as a partial unique index; MySQL has no
# partial indexes, so it gets a virtual generated column that is NULL for non-owners
# (NULLs never collide in a UNIQUE index) plus a unique index on that column.
event.listen(
    WorkspaceMembership.__table__,
    "after_create",
    DDL(
        "CREATE UNIQUE INDEX uq_workspace_memberships_owner "
        "ON workspace_memberships (workspace_id) WHERE role = 'owner'"
    ).execute_if(dialect="sqlite"),
)
event.listen(
    WorkspaceMembership.__table__,
    "after_create",
    DDL(
        "ALTER TABLE workspace_memberships ADD COLUMN owner_workspace_id VARCHAR(64) "
        "GENERATED ALWAYS AS (CASE WHEN role = 'owner' THEN workspace_id ELSE NULL END) VIRTUAL, "
        "ADD UNIQUE INDEX uq_workspace_memberships_owner (owner_workspace_id)"
    ).execute_if(dialect="mysql"),
)


class WorkspaceInvitation(Base):
    __tablename__ = "workspace_invitations"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    email_normalized: Mapped[str] = mapped_column(NAME, nullable=False)
    token_hash: Mapped[str] = mapped_column(HASH, nullable=False, unique=True)
    invited_by_user_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    expires_at: Mapped[float] = mapped_column(REAL, nullable=False)
    accepted_at: Mapped[float | None] = mapped_column(REAL, nullable=True)
    accepted_by_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    revoked_at: Mapped[float | None] = mapped_column(REAL, nullable=True)
    access_role: Mapped[str] = mapped_column(LABEL, nullable=False, server_default="member")

    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_workspace_invitations_expiry"),
        Index("ix_workspace_invitations_workspace", "workspace_id", "created_at"),
        Index("ix_workspace_invitations_email", "email_normalized", "expires_at"),
    )


class WorkspaceProviderConfig(Base):
    __tablename__ = "workspace_provider_configs"

    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        primary_key=True,
    )
    config_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("{}"))
    updated_by_user_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("json_valid(config_json)", name="ck_workspace_provider_configs_json"),
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    refresh_token_hash: Mapped[str] = mapped_column(HASH, nullable=False)
    rotation_counter: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    expires_at: Mapped[float] = mapped_column(REAL, nullable=False)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    last_used_at: Mapped[float | None] = mapped_column(REAL, nullable=True)
    revoked_at: Mapped[float | None] = mapped_column(REAL, nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(BIG, nullable=True)
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

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    actor_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    object_type: Mapped[str] = mapped_column(NAME, nullable=False)
    object_id: Mapped[str] = mapped_column(NAME, nullable=False)
    metadata_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("{}"))
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("json_valid(metadata_json)", name="ck_audit_events_metadata_json"),
        Index("ix_audit_events_workspace_created", "workspace_id", "created_at"),
        Index("ix_audit_events_object", "object_type", "object_id", "created_at"),
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    workspace_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(NAME, nullable=False)
    description: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default(""))
    mode: Mapped[str] = mapped_column(KEY, nullable=False, server_default="standalone")
    legacy_series_id: Mapped[str | None] = mapped_column(KEY, nullable=True)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    metadata_json: Mapped[str] = mapped_column(
        BIG,
        nullable=False,
        server_default=text_default("{}"),
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

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default(""))
    payload_json: Mapped[str] = mapped_column(BIG, nullable=False)
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

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    series_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("series.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    episode_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(LABEL, nullable=False, server_default="draft")
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    metadata_json: Mapped[str] = mapped_column(
        BIG,
        nullable=False,
        server_default=text_default("{}"),
    )

    __table_args__ = (
        CheckConstraint("json_valid(metadata_json)", name="ck_episodes_metadata_json"),
        UniqueConstraint("project_id", "episode_number"),
        Index("ix_episodes_project_order", "project_id", "episode_number", "created_at"),
        Index("ix_episodes_series_order", "series_id", "episode_number"),
    )


class SourceDocument(Base):
    """A workspace-owned source document used as upstream story material."""

    __tablename__ = "source_documents"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(LABEL, nullable=False, server_default="text")
    original_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    encoding: Mapped[str] = mapped_column(LABEL, nullable=False, server_default="utf-8")
    summary: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default(""))
    metadata_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("{}"))
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("length(trim(title)) > 0", name="ck_source_documents_title"),
        CheckConstraint(
            "source_type IN ('text', 'txt', 'markdown', 'docx', 'paste')",
            name="ck_source_documents_type",
        ),
        CheckConstraint("json_valid(metadata_json)", name="ck_source_documents_metadata_json"),
        Index("ix_source_documents_workspace_updated", "workspace_id", "updated_at"),
    )


class SourceChapter(Base):
    """An ordered chapter boundary within a SourceDocument."""

    __tablename__ = "source_chapters"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    source_document_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    current_revision_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("source_revisions.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("chapter_number > 0", name="ck_source_chapters_number"),
        CheckConstraint("length(trim(title)) > 0", name="ck_source_chapters_title"),
        UniqueConstraint("source_document_id", "chapter_number"),
        Index("ix_source_chapters_document_order", "source_document_id", "chapter_number"),
    )


class SourceRevision(Base):
    """Immutable source text revision for one chapter."""

    __tablename__ = "source_revisions"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    source_document_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    chapter_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_chapters.id", ondelete="CASCADE"),
        nullable=False,
    )
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(BIG, nullable=False)
    content_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    metadata_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("{}"))
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("revision_number > 0", name="ck_source_revisions_number"),
        CheckConstraint("length(trim(content)) > 0", name="ck_source_revisions_content"),
        CheckConstraint("length(content_sha256) = 64", name="ck_source_revisions_sha256"),
        CheckConstraint("json_valid(metadata_json)", name="ck_source_revisions_metadata_json"),
        UniqueConstraint("chapter_id", "revision_number"),
        Index("ix_source_revisions_chapter_created", "chapter_id", "created_at"),
        Index("ix_source_revisions_document", "source_document_id", "created_at"),
    )


class SourceRevisionImpact(Base):
    """Durable impact event emitted when a Source chapter revision changes."""

    __tablename__ = "source_revision_impacts"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_document_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    chapter_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_chapters.id", ondelete="CASCADE"),
        nullable=False,
    )
    revision_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_revisions.id", ondelete="CASCADE"),
        nullable=False,
    )
    previous_revision_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("source_revisions.id", ondelete="SET NULL"),
        nullable=True,
    )
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_revision_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    change_type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(LABEL, nullable=False, server_default="open")
    created_by_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "change_type IN ('chapter_edit', 'revision_restore')",
            name="ck_source_revision_impacts_change_type",
        ),
        CheckConstraint(
            "status IN ('open', 'resolved')",
            name="ck_source_revision_impacts_status",
        ),
        CheckConstraint("revision_number > 0", name="ck_source_revision_impacts_revision_number"),
        CheckConstraint(
            "previous_revision_number IS NULL OR previous_revision_number > 0",
            name="ck_source_revision_impacts_previous_revision_number",
        ),
        Index("ix_source_revision_impacts_workspace_created", "workspace_id", "created_at"),
        Index("ix_source_revision_impacts_source_created", "source_document_id", "created_at"),
        Index("ix_source_revision_impacts_revision", "revision_id"),
    )


class SourceImpactTarget(Base):
    """Snapshot of one downstream target that needs review after a revision."""

    __tablename__ = "source_impact_targets"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    impact_event_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_revision_impacts.id", ondelete="CASCADE"),
        nullable=False,
    )
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_document_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    chapter_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_chapters.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_type: Mapped[str] = mapped_column(KEY, nullable=False)
    target_id: Mapped[str] = mapped_column(NAME, nullable=False)
    episode_id: Mapped[str | None] = mapped_column(KEY, nullable=True)
    target_stage: Mapped[str] = mapped_column(KEY, nullable=False)
    status: Mapped[str] = mapped_column(KEY, nullable=False, server_default="needs_review")
    metadata_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("{}"))
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "target_type IN ('script', 'shot', 'downstream')",
            name="ck_source_impact_targets_type",
        ),
        CheckConstraint(
            "status IN ('needs_review', 'resolved')",
            name="ck_source_impact_targets_status",
        ),
        CheckConstraint("length(trim(target_id)) > 0", name="ck_source_impact_targets_id"),
        CheckConstraint("length(trim(target_stage)) > 0", name="ck_source_impact_targets_stage"),
        CheckConstraint("json_valid(metadata_json)", name="ck_source_impact_targets_metadata_json"),
        UniqueConstraint(
            "impact_event_id",
            "episode_id",
            "target_type",
            "target_id",
            "target_stage",
            name="uq_source_impact_targets_target",
        ),
        Index("ix_source_impact_targets_event_status", "impact_event_id", "status"),
        Index("ix_source_impact_targets_workspace_created", "workspace_id", "created_at"),
        Index("ix_source_impact_targets_target", "target_type", "target_id", "status"),
    )


class SourceEpisodeLink(Base):
    """Many-to-many relationship between source documents and episodes."""

    __tablename__ = "source_episode_links"

    source_document_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_documents.id", ondelete="CASCADE"),
        primary_key=True,
    )
    episode_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("episodes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_by_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        Index("ix_source_episode_links_episode", "episode_id", "created_at"),
        Index("ix_source_episode_links_source", "source_document_id", "created_at"),
    )


class SourceImportPreview(Base):
    """Durable workspace-scoped draft for the Source import preview flow."""

    __tablename__ = "source_import_previews"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_type: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    original_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    encoding: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(BIG, nullable=False)
    content_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default(""))
    proposals_json: Mapped[str] = mapped_column(BIG, nullable=False)
    status: Mapped[str] = mapped_column(KEY, nullable=False, server_default="previewing")
    source_document_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("source_documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "source_type IN ('text', 'txt', 'markdown', 'docx', 'paste')",
            name="ck_source_import_previews_type",
        ),
        CheckConstraint(
            "status IN ('previewing', 'confirmed', 'canceled')",
            name="ck_source_import_previews_status",
        ),
        CheckConstraint("length(trim(title)) > 0", name="ck_source_import_previews_title"),
        CheckConstraint("length(trim(content)) > 0", name="ck_source_import_previews_content"),
        CheckConstraint("length(content_sha256) = 64", name="ck_source_import_previews_sha256"),
        CheckConstraint("json_valid(proposals_json)", name="ck_source_import_previews_proposals_json"),
        Index("ix_source_import_previews_workspace_updated", "workspace_id", "updated_at"),
        Index("ix_source_import_previews_status", "workspace_id", "status", "updated_at"),
    )


class SourceEpisodeSplitPreview(Base):
    """Durable AI episode-split draft; confirmation is the only write path."""

    __tablename__ = "source_episode_split_previews"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_document_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(BIG, nullable=False)
    content_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_episodes: Mapped[int] = mapped_column(Integer, nullable=False)
    proposals_json: Mapped[str] = mapped_column(BIG, nullable=False)
    status: Mapped[str] = mapped_column(KEY, nullable=False, server_default="previewing")
    series_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    episode_ids_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("[]"))
    created_by_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("length(trim(title)) > 0", name="ck_source_episode_split_previews_title"),
        CheckConstraint("length(trim(content)) > 0", name="ck_source_episode_split_previews_content"),
        CheckConstraint("length(content_sha256) = 64", name="ck_source_episode_split_previews_sha256"),
        CheckConstraint("suggested_episodes BETWEEN 1 AND 50", name="ck_source_episode_split_previews_count"),
        CheckConstraint(
            "status IN ('previewing', 'confirmed', 'canceled')",
            name="ck_source_episode_split_previews_status",
        ),
        CheckConstraint("json_valid(proposals_json)", name="ck_source_episode_split_previews_proposals_json"),
        CheckConstraint("json_valid(episode_ids_json)", name="ck_source_episode_split_previews_episode_ids_json"),
        Index("ix_source_episode_split_previews_source_updated", "source_document_id", "updated_at"),
        Index("ix_source_episode_split_previews_status", "workspace_id", "status", "updated_at"),
    )


class SourceChapterAnalysis(Base):
    """Immutable analysis attempt for one Source chapter revision."""

    __tablename__ = "source_chapter_analyses"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_document_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    chapter_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_chapters.id", ondelete="CASCADE"),
        nullable=False,
    )
    revision_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_revisions.id", ondelete="CASCADE"),
        nullable=False,
    )
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(KEY, nullable=False)
    events_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("[]"))
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(BIG, nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    retry_of: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)
    finished_at: Mapped[float | None] = mapped_column(REAL, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('processing', 'succeeded', 'failed')",
            name="ck_source_chapter_analyses_status",
        ),
        CheckConstraint("revision_number > 0", name="ck_source_chapter_analyses_revision_number"),
        CheckConstraint("length(content_sha256) = 64", name="ck_source_chapter_analyses_sha256"),
        CheckConstraint("attempt > 0", name="ck_source_chapter_analyses_attempt"),
        CheckConstraint("json_valid(events_json)", name="ck_source_chapter_analyses_events_json"),
        Index("ix_source_chapter_analyses_chapter_created", "chapter_id", "created_at"),
        Index("ix_source_chapter_analyses_source_status", "source_document_id", "status", "updated_at"),
        Index("ix_source_chapter_analyses_workspace_updated", "workspace_id", "updated_at"),
    )


class SourceAnalysisBatch(Base):
    """Durable batch envelope for chapter event analysis."""

    __tablename__ = "source_analysis_batches"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_document_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(LABEL, nullable=False, server_default="processing")
    requested_chapter_ids_json: Mapped[str] = mapped_column(BIG, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    succeeded: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    failed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    skipped: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_by_user_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('processing', 'succeeded', 'partially_succeeded', 'failed', 'skipped')",
            name="ck_source_analysis_batches_status",
        ),
        CheckConstraint("json_valid(requested_chapter_ids_json)", name="ck_source_analysis_batches_chapters_json"),
        CheckConstraint("total >= 0 AND succeeded >= 0 AND failed >= 0 AND skipped >= 0", name="ck_source_analysis_batches_counts"),
        Index("ix_source_analysis_batches_workspace_updated", "workspace_id", "updated_at"),
        Index("ix_source_analysis_batches_source_updated", "source_document_id", "updated_at"),
    )


class SourceAnalysisBatchItem(Base):
    """Per-chapter result ledger for a Source analysis batch."""

    __tablename__ = "source_analysis_batch_items"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    batch_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_analysis_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_document_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    chapter_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("source_chapters.id", ondelete="CASCADE"),
        nullable=False,
    )
    analysis_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("source_chapter_analyses.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(KEY, nullable=False, server_default="pending")
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(BIG, nullable=True)
    skip_reason: Mapped[str | None] = mapped_column(BIG, nullable=True)
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'processing', 'succeeded', 'failed', 'skipped')",
            name="ck_source_analysis_batch_items_status",
        ),
        CheckConstraint("attempt >= 0", name="ck_source_analysis_batch_items_attempt"),
        UniqueConstraint("batch_id", "chapter_id", name="uq_source_analysis_batch_items_chapter"),
        Index("ix_source_analysis_batch_items_batch_status", "batch_id", "status"),
        Index("ix_source_analysis_batch_items_workspace_updated", "workspace_id", "updated_at"),
    )


class Script(Base):
    __tablename__ = "scripts"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    episode_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("episodes.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    original_text: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default(""))
    payload_json: Mapped[str] = mapped_column(BIG, nullable=False)
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
        KEY,
        ForeignKey("scripts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    holder_user_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    client_instance_id: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(HASH, nullable=False, unique=True)
    acquired_at: Mapped[float] = mapped_column(REAL, nullable=False)
    heartbeat_at: Mapped[float] = mapped_column(REAL, nullable=False)
    expires_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("expires_at > heartbeat_at", name="ck_script_edit_leases_expiry"),
        Index("ix_script_edit_leases_expiry", "expires_at"),
        Index("ix_script_edit_leases_holder", "holder_user_id", "expires_at"),
    )


class DirectorPlan(Base):
    """Workspace-scoped layered director-plan overrides."""

    __tablename__ = "director_plans"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    scope: Mapped[str] = mapped_column(KEY, nullable=False)
    scope_id: Mapped[str] = mapped_column(NAME, nullable=False)
    project_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    episode_id: Mapped[str | None] = mapped_column(KEY, nullable=True)
    shot_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("{}"))
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("scope IN ('project', 'episode', 'shot')", name="ck_director_plans_scope"),
        CheckConstraint("length(trim(scope_id)) > 0", name="ck_director_plans_scope_id"),
        CheckConstraint("json_valid(payload_json)", name="ck_director_plans_payload_json"),
        UniqueConstraint("workspace_id", "scope", "scope_id", name="uq_director_plans_workspace_scope"),
        Index("ix_director_plans_workspace_updated", "workspace_id", "updated_at"),
        Index("ix_director_plans_episode", "workspace_id", "episode_id", "updated_at"),
    )


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    episode_id: Mapped[str | None] = mapped_column(
        KEY,
        ForeignKey("episodes.id", ondelete="SET NULL"),
        nullable=True,
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("{}"))
    created_at: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[float] = mapped_column(REAL, nullable=False)

    __table_args__ = (
        CheckConstraint("json_valid(metadata_json)", name="ck_jobs_metadata_json"),
        Index("ix_jobs_workspace_updated", "workspace_id", "updated_at"),
        Index("ix_jobs_project_episode", "project_id", "episode_id", "updated_at"),
    )


class JobItem(Base):
    __tablename__ = "job_items"

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    job_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    workspace_id: Mapped[str] = mapped_column(
        KEY,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    episode_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(KEY, nullable=False, server_default="pending")
    progress: Mapped[float] = mapped_column(REAL, nullable=False, server_default="0")
    idempotency_key: Mapped[str] = mapped_column(NAME, nullable=False)
    retry_of: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("{}"))
    media_refs_json: Mapped[str] = mapped_column(BIG, nullable=False, server_default=text_default("[]"))
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(BIG, nullable=True)
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

    id: Mapped[str] = mapped_column(KEY, primary_key=True)
    item_id: Mapped[str] = mapped_column(
        KEY,
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
    "SourceDocument",
    "SourceChapter",
    "SourceRevision",
    "SourceRevisionImpact",
    "SourceImpactTarget",
    "SourceEpisodeLink",
    "SourceImportPreview",
    "SourceEpisodeSplitPreview",
    "SourceChapterAnalysis",
    "SourceAnalysisBatch",
    "SourceAnalysisBatchItem",
    "Script",
    "ScriptEditLease",
    "Job",
    "JobItem",
    "JobItemEvent",
]
