"""Storage-layer exception types."""


class StorageError(Exception):
    """Base exception for storage initialization and persistence failures."""

    def __init__(self, message: str) -> None:
        self.message = str(message)
        super().__init__(self.message)


class StorageConflictError(StorageError):
    """Raised when a stale aggregate attempts to overwrite newer persisted data."""


class MigrationError(StorageError):
    """Raised when a schema or data migration cannot be completed safely."""


class LegacyDataError(StorageError):
    """Raised when legacy JSON data is present but invalid or inconsistent."""
