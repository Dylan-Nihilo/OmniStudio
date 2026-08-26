"""LumenX storage infrastructure package."""

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
from .schema import (
    Base,
    Episode,
    MigrationRun,
    Project,
    SchemaMigration,
    Script,
    Session,
    Series,
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
]
