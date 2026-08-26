"""Short-transaction repository for authentication identities and sessions."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any, Mapping

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.engine import Engine

from .db import begin_immediate
from .schema import Session, User, Workspace


def _values(value: Mapping[str, Any] | Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if hasattr(value, "model_dump"):
        return dict(value.model_dump())
    if hasattr(value, "__dict__"):
        return dict(vars(value))
    raise TypeError(f"Expected a mapping-like value, got {type(value).__name__}")


def _model_from_mapping(model_type: type[Any], row: Mapping[str, Any] | None) -> Any | None:
    return model_type(**dict(row)) if row is not None else None


@dataclass(frozen=True)
class OwnerSetupResult:
    user: User
    workspace: Workspace
    session: Session


@dataclass(frozen=True)
class RotateResult:
    rotated: bool
    session: Session | None
    reason: str | None = None

    def __bool__(self) -> bool:
        return self.rotated


class AuthRepository:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def count_users(self) -> int:
        with self.engine.connect() as connection:
            return int(connection.scalar(select(func.count()).select_from(User.__table__)) or 0)

    def find_user_by_username(self, username_normalized: str) -> User | None:
        return self._find_user(User.username_normalized == username_normalized)

    def find_user_by_email(self, email_normalized: str) -> User | None:
        return self._find_user(User.email_normalized == email_normalized)

    def find_user_by_login(self, normalized_identifier: str) -> User | None:
        return self._find_user(
            or_(
                User.username_normalized == normalized_identifier,
                User.email_normalized == normalized_identifier,
            )
        )

    def _find_user(self, criterion: Any) -> User | None:
        statement = select(User.__table__).where(criterion).limit(1)
        with self.engine.connect() as connection:
            row = connection.execute(statement).mappings().first()
        return _model_from_mapping(User, row)

    def get_user(self, user_id: str) -> User | None:
        with self.engine.connect() as connection:
            row = connection.execute(
                select(User.__table__).where(User.id == user_id)
            ).mappings().first()
        return _model_from_mapping(User, row)

    def create_user(self, values: Mapping[str, Any] | Any) -> User:
        data = _values(values)
        data.setdefault("id", str(uuid.uuid4()))
        now = time.time()
        data.setdefault("created_at", now)
        data.setdefault("updated_at", now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                connection.execute(User.__table__.insert().values(**data))
            row = connection.execute(
                select(User.__table__).where(User.id == data["id"])
            ).mappings().one()
        return _model_from_mapping(User, row)

    def get_default_workspace(self, user_id: str) -> Workspace | None:
        statement = (
            select(Workspace.__table__)
            .where(and_(Workspace.owner_user_id == user_id, Workspace.slug == "default"))
            .limit(1)
        )
        with self.engine.connect() as connection:
            row = connection.execute(statement).mappings().first()
        return _model_from_mapping(Workspace, row)

    def get_workspace(self, workspace_id: str) -> Workspace | None:
        with self.engine.connect() as connection:
            row = connection.execute(
                select(Workspace.__table__).where(Workspace.id == workspace_id)
            ).mappings().first()
        return _model_from_mapping(Workspace, row)

    def create_workspace(self, values: Mapping[str, Any] | Any) -> Workspace:
        data = _values(values)
        data.setdefault("id", str(uuid.uuid4()))
        now = time.time()
        data.setdefault("created_at", now)
        data.setdefault("updated_at", now)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                connection.execute(Workspace.__table__.insert().values(**data))
            row = connection.execute(
                select(Workspace.__table__).where(Workspace.id == data["id"])
            ).mappings().one()
        return _model_from_mapping(Workspace, row)

    def create_session(self, values: Mapping[str, Any] | Any) -> Session:
        data = _values(values)
        data.setdefault("id", str(uuid.uuid4()))
        data["user_agent"] = (data.get("user_agent") or "")[:512] or None
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                connection.execute(Session.__table__.insert().values(**data))
            row = connection.execute(
                select(Session.__table__).where(Session.id == data["id"])
            ).mappings().one()
        return _model_from_mapping(Session, row)

    def create_owner_atomically(
        self,
        *,
        user_values: Mapping[str, Any] | Any,
        workspace_values: Mapping[str, Any] | Any,
        session_values: Mapping[str, Any] | Any,
    ) -> OwnerSetupResult:
        user_data = _values(user_values)
        workspace_data = _values(workspace_values)
        session_data = _values(session_values)
        user_data.setdefault("id", str(uuid.uuid4()))
        now = time.time()
        user_data.setdefault("created_at", now)
        user_data.setdefault("updated_at", now)
        workspace_data.setdefault("id", str(uuid.uuid4()))
        workspace_data.setdefault("owner_user_id", user_data["id"])
        workspace_data.setdefault("created_at", now)
        workspace_data.setdefault("updated_at", now)
        session_data.setdefault("id", str(uuid.uuid4()))
        session_data.setdefault("user_id", user_data["id"])
        session_data["user_agent"] = (session_data.get("user_agent") or "")[:512] or None

        with self.engine.connect() as connection:
            with begin_immediate(connection):
                count = int(connection.scalar(select(func.count()).select_from(User.__table__)) or 0)
                if count:
                    raise ValueError("AUTH_ALREADY_INITIALIZED")
                connection.execute(User.__table__.insert().values(**user_data))
                connection.execute(Workspace.__table__.insert().values(**workspace_data))
                connection.execute(Session.__table__.insert().values(**session_data))
                user_row = connection.execute(
                    select(User.__table__).where(User.id == user_data["id"])
                ).mappings().one()
                workspace_row = connection.execute(
                    select(Workspace.__table__).where(Workspace.id == workspace_data["id"])
                ).mappings().one()
                session_row = connection.execute(
                    select(Session.__table__).where(Session.id == session_data["id"])
                ).mappings().one()
        return OwnerSetupResult(
            user=_model_from_mapping(User, user_row),
            workspace=_model_from_mapping(Workspace, workspace_row),
            session=_model_from_mapping(Session, session_row),
        )

    def get_session(self, session_id: str) -> Session | None:
        with self.engine.connect() as connection:
            row = connection.execute(
                select(Session.__table__).where(Session.id == session_id)
            ).mappings().first()
        return _model_from_mapping(Session, row)

    def rotate_refresh_token(
        self,
        *,
        session_id: str,
        expected_hash: str,
        expected_rotation: int,
        new_hash: str,
        now: float,
    ) -> RotateResult:
        statement = (
            update(Session.__table__)
            .where(
                Session.id == session_id,
                Session.refresh_token_hash == expected_hash,
                Session.rotation_counter == expected_rotation,
                Session.revoked_at.is_(None),
                Session.expires_at > now,
            )
            .values(
                refresh_token_hash=new_hash,
                rotation_counter=expected_rotation + 1,
                last_used_at=now,
            )
        )
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                result = connection.execute(statement)
                row = connection.execute(
                    select(Session.__table__).where(Session.id == session_id)
                ).mappings().first()
        if result.rowcount != 1:
            return RotateResult(False, _model_from_mapping(Session, row), "cas_mismatch")
        return RotateResult(True, _model_from_mapping(Session, row))

    def revoke_session(self, session_id: str, *, reason: str, now: float) -> bool:
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                result = connection.execute(
                    update(Session.__table__)
                    .where(Session.id == session_id, Session.revoked_at.is_(None))
                    .values(revoked_at=now, revoke_reason=reason)
                )
        return result.rowcount == 1

    def revoke_all_user_sessions(self, user_id: str, *, reason: str, now: float) -> int:
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                result = connection.execute(
                    update(Session.__table__)
                    .where(Session.user_id == user_id, Session.revoked_at.is_(None))
                    .values(revoked_at=now, revoke_reason=reason)
                )
        return int(result.rowcount or 0)

    def update_password_and_revoke_sessions(
        self, user_id: str, *, new_password_hash: str, now: float
    ) -> int:
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                connection.execute(
                    update(User.__table__)
                    .where(User.id == user_id)
                    .values(password_hash=new_password_hash, updated_at=now)
                )
                result = connection.execute(
                    update(Session.__table__)
                    .where(Session.user_id == user_id, Session.revoked_at.is_(None))
                    .values(revoked_at=now, revoke_reason="password_change")
                )
        return int(result.rowcount or 0)


__all__ = ["AuthRepository", "OwnerSetupResult", "RotateResult"]
