"""Argon2id password hashing with bounded process-level concurrency."""

from __future__ import annotations

import threading
from typing import Final

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

PASSWORD_TIME_COST: Final = 3
PASSWORD_MEMORY_COST: Final = 65536
PASSWORD_PARALLELISM: Final = 4
PASSWORD_HASH_LENGTH: Final = 32
PASSWORD_SALT_LENGTH: Final = 16
ARGON2_MAX_CONCURRENCY: Final = 2

_PASSWORD_HASHER = PasswordHasher(
    time_cost=PASSWORD_TIME_COST,
    memory_cost=PASSWORD_MEMORY_COST,
    parallelism=PASSWORD_PARALLELISM,
    hash_len=PASSWORD_HASH_LENGTH,
    salt_len=PASSWORD_SALT_LENGTH,
)
_ARGON2_SEMAPHORE = threading.BoundedSemaphore(ARGON2_MAX_CONCURRENCY)
_DUMMY_PASSWORD: Final = "omni_studio-auth-dummy-password-v1"
_DUMMY_HASH: str | None = None
_DUMMY_HASH_LOCK = threading.Lock()


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        with _DUMMY_HASH_LOCK:
            if _DUMMY_HASH is None:
                with _ARGON2_SEMAPHORE:
                    _DUMMY_HASH = _PASSWORD_HASHER.hash(_DUMMY_PASSWORD)
    return _DUMMY_HASH


def hash_password(password: str) -> str:
    if not isinstance(password, str) or not password:
        raise ValueError("password must be a non-empty string")
    with _ARGON2_SEMAPHORE:
        return _PASSWORD_HASHER.hash(password)


def verify_password(password: str, encoded_hash: str | None) -> bool:
    """Verify a password; missing/invalid hashes still perform a dummy verify."""
    candidate_hash = encoded_hash if isinstance(encoded_hash, str) and encoded_hash else _dummy_hash()
    try:
        with _ARGON2_SEMAPHORE:
            return bool(_PASSWORD_HASHER.verify(candidate_hash, password))
    except VerifyMismatchError:
        # The real hash was verified at the configured cost, so the failure path
        # has equivalent work to a successful verification.
        return False
    except (VerificationError, InvalidHashError, TypeError, ValueError):
        # An unknown/malformed stored hash is an authentication failure, not a
        # signal to callers that the account exists or that storage is corrupt.
        # Resolve the dummy hash before acquiring the semaphore: its lazy
        # initializer also acquires this non-reentrant semaphore.
        dummy_password = password if isinstance(password, str) else str(password)
        dummy_hash = _dummy_hash()
        try:
            with _ARGON2_SEMAPHORE:
                _PASSWORD_HASHER.verify(dummy_hash, dummy_password)
        except Exception:
            pass
        return False


def password_needs_rehash(encoded_hash: str | None) -> bool:
    if not isinstance(encoded_hash, str) or not encoded_hash:
        return True
    try:
        return bool(_PASSWORD_HASHER.check_needs_rehash(encoded_hash))
    except (InvalidHashError, TypeError, ValueError):
        return True


__all__ = [
    "ARGON2_MAX_CONCURRENCY",
    "PASSWORD_HASH_LENGTH",
    "PASSWORD_MEMORY_COST",
    "PASSWORD_PARALLELISM",
    "PASSWORD_SALT_LENGTH",
    "PASSWORD_TIME_COST",
    "hash_password",
    "password_needs_rehash",
    "verify_password",
]
