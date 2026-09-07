"""Omni Studio storage infrastructure package."""

from .db import (
    DEFAULT_DB_PATH,
    INITIAL_SCHEMA_VERSION,
    SCHEMA_CHECKSUM,
    SCHEMA_DESCRIPTION,
    SCHEMA_VERSION,
    create_engine,
    create_session_factory,
    get_session_factory,
    init_schema,
)
from .auth_repository import AuthRepository, OwnerSetupResult, RotateResult
from .errors import LegacyDataError, MigrationError, StorageError
from .repository import Repository, SQLiteRepository
from .source_repository import SourceRepository, SourceRepositoryError
from .schema import (
    Base,
    Episode,
    MigrationRun,
    Project,
    SchemaMigration,
    Script,
    Session,
    Series,
    SourceChapter,
    SourceDocument,
    SourceEpisodeLink,
    SourceRevision,
    User,
    Workspace,
)

__all__ = [
    "Base",
    "DEFAULT_DB_PATH",
    "INITIAL_SCHEMA_VERSION",
    "SCHEMA_CHECKSUM",
    "SCHEMA_DESCRIPTION",
    "SCHEMA_VERSION",
    "create_engine",
    "create_session_factory",
    "get_session_factory",
    "init_schema",
    "AuthRepository",
    "OwnerSetupResult",
    "RotateResult",
    "StorageError",
    "MigrationError",
    "LegacyDataError",
    "Repository",
    "SQLiteRepository",
    "SchemaMigration",
    "MigrationRun",
    "User",
    "Workspace",
    "Project",
    "Series",
    "Episode",
    "Script",
    "Session",
    "SourceDocument",
    "SourceChapter",
    "SourceRevision",
    "SourceEpisodeLink",
    "SourceRepository",
    "SourceRepositoryError",
]
