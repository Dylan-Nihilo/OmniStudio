"""Short-transaction repository for authentication identities and sessions."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any, Mapping

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.engine import Engine

from .db import begin_immediate
from .schema import (
    Session,
    User,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
    WorkspaceProviderConfig,
)


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
class WorkspaceAccess:
    workspace: Workspace
    role: str


@dataclass(frozen=True)
class InvitationRegistrationResult:
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
        statement = select(Workspace.__table__).join(
            WorkspaceMembership.__table__,
            WorkspaceMembership.workspace_id == Workspace.id,
        ).where(
            WorkspaceMembership.user_id == user_id,
            WorkspaceMembership.role == "owner",
            Workspace.slug == "default",
        ).limit(1)
        with self.engine.connect() as connection:
            row = connection.execute(statement).mappings().first()
        return _model_from_mapping(Workspace, row)

    def list_user_workspaces(self, user_id: str) -> list[WorkspaceAccess]:
        statement = (
            select(Workspace.__table__, WorkspaceMembership.role.label("membership_role"))
            .join(
                WorkspaceMembership.__table__,
                WorkspaceMembership.workspace_id == Workspace.id,
            )
            .where(WorkspaceMembership.user_id == user_id)
            .order_by(WorkspaceMembership.joined_at, Workspace.name)
        )
        with self.engine.connect() as connection:
            rows = connection.execute(statement).mappings().all()
        return [
            WorkspaceAccess(
                workspace=Workspace(**{column.name: row[column.name] for column in Workspace.__table__.columns}),
                role=str(row["membership_role"]),
            )
            for row in rows
        ]

    def get_membership(self, workspace_id: str, user_id: str) -> WorkspaceMembership | None:
        with self.engine.connect() as connection:
            row = connection.execute(
                select(WorkspaceMembership.__table__).where(
                    WorkspaceMembership.workspace_id == workspace_id,
                    WorkspaceMembership.user_id == user_id,
                )
            ).mappings().first()
        return _model_from_mapping(WorkspaceMembership, row)

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

    def create_owned_workspace(
        self,
        *,
        user_id: str,
        name: str,
        slug: str,
        now: float,
    ) -> WorkspaceAccess:
        workspace_id = str(uuid.uuid4())
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                connection.execute(
                    Workspace.__table__.insert().values(
                        id=workspace_id,
                        owner_user_id=user_id,
                        name=name,
                        slug=slug,
                        created_at=now,
                        updated_at=now,
                        metadata_json="{}",
                    )
                )
                connection.execute(
                    WorkspaceMembership.__table__.insert().values(
                        workspace_id=workspace_id,
                        user_id=user_id,
                        role="owner",
                        invited_by_user_id=None,
                        joined_at=now,
                    )
                )
                row = connection.execute(
                    select(Workspace.__table__).where(Workspace.id == workspace_id)
                ).mappings().one()
        return WorkspaceAccess(_model_from_mapping(Workspace, row), "owner")

    def create_invitation(
        self,
        *,
        workspace_id: str,
        email_normalized: str,
        token_hash: str,
        invited_by_user_id: str,
        now: float,
        expires_at: float,
    ) -> WorkspaceInvitation:
        invitation_id = str(uuid.uuid4())
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                connection.execute(
                    WorkspaceInvitation.__table__.insert().values(
                        id=invitation_id,
                        workspace_id=workspace_id,
                        email_normalized=email_normalized,
                        token_hash=token_hash,
                        invited_by_user_id=invited_by_user_id,
                        created_at=now,
                        expires_at=expires_at,
                    )
                )
                row = connection.execute(
                    select(WorkspaceInvitation.__table__).where(
                        WorkspaceInvitation.id == invitation_id
                    )
                ).mappings().one()
        return _model_from_mapping(WorkspaceInvitation, row)

    def list_workspace_members(self, workspace_id: str) -> list[dict[str, Any]]:
        statement = (
            select(
                User.id,
                User.username,
                User.email,
                User.display_name,
                WorkspaceMembership.role,
                WorkspaceMembership.joined_at,
            )
            .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
            .where(WorkspaceMembership.workspace_id == workspace_id)
            .order_by(WorkspaceMembership.role.desc(), WorkspaceMembership.joined_at)
        )
        with self.engine.connect() as connection:
            return [dict(row) for row in connection.execute(statement).mappings().all()]

    def remove_member(self, workspace_id: str, user_id: str) -> bool:
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                membership = connection.execute(
                    select(WorkspaceMembership.role).where(
                        WorkspaceMembership.workspace_id == workspace_id,
                        WorkspaceMembership.user_id == user_id,
                    )
                ).scalar_one_or_none()
                if membership == "owner":
                    raise ValueError("WORKSPACE_OWNER_CANNOT_BE_REMOVED")
                result = connection.execute(
                    delete(WorkspaceMembership).where(
                        WorkspaceMembership.workspace_id == workspace_id,
                        WorkspaceMembership.user_id == user_id,
                    )
                )
        return result.rowcount == 1

    def get_workspace_provider_config(self, workspace_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            raw = connection.execute(
                select(WorkspaceProviderConfig.config_json).where(
                    WorkspaceProviderConfig.workspace_id == workspace_id
                )
            ).scalar_one_or_none()
        return json.loads(raw) if raw else {}

    def update_workspace_provider_config(
        self,
        *,
        workspace_id: str,
        user_id: str,
        values: Mapping[str, str],
        removed_keys: list[str],
        now: float,
    ) -> dict[str, Any]:
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                raw = connection.execute(
                    select(WorkspaceProviderConfig.config_json).where(
                        WorkspaceProviderConfig.workspace_id == workspace_id
                    )
                ).scalar_one_or_none()
                config = json.loads(raw) if raw else {}
                config.update(values)
                for key in removed_keys:
                    config[key] = ""
                payload = json.dumps(config, ensure_ascii=False, sort_keys=True)
                if raw is None:
                    connection.execute(
                        WorkspaceProviderConfig.__table__.insert().values(
                            workspace_id=workspace_id,
                            config_json=payload,
                            updated_by_user_id=user_id,
                            updated_at=now,
                        )
                    )
                else:
                    connection.execute(
                        update(WorkspaceProviderConfig)
                        .where(WorkspaceProviderConfig.workspace_id == workspace_id)
                        .values(
                            config_json=payload,
                            updated_by_user_id=user_id,
                            updated_at=now,
                        )
                    )
        return config

    def register_from_invitation_atomically(
        self,
        *,
        token_hash: str,
        now: float,
        user_values: Mapping[str, Any],
        workspace_values: Mapping[str, Any],
        session_values: Mapping[str, Any],
    ) -> InvitationRegistrationResult:
        user_data = dict(user_values)
        workspace_data = dict(workspace_values)
        session_data = dict(session_values)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                invitation = connection.execute(
                    select(WorkspaceInvitation.__table__).where(
                        WorkspaceInvitation.token_hash == token_hash,
                        WorkspaceInvitation.accepted_at.is_(None),
                        WorkspaceInvitation.revoked_at.is_(None),
                        WorkspaceInvitation.expires_at > now,
                    )
                ).mappings().first()
                if invitation is None:
                    raise ValueError("AUTH_INVITATION_INVALID")
                if invitation["email_normalized"] != user_data["email_normalized"]:
                    raise ValueError("AUTH_INVITATION_EMAIL_MISMATCH")

                connection.execute(User.__table__.insert().values(**user_data))
                connection.execute(Workspace.__table__.insert().values(**workspace_data))
                connection.execute(
                    WorkspaceMembership.__table__.insert().values(
                        workspace_id=workspace_data["id"],
                        user_id=user_data["id"],
                        role="owner",
                        invited_by_user_id=None,
                        joined_at=now,
                    )
                )
                connection.execute(
                    WorkspaceMembership.__table__.insert().values(
                        workspace_id=invitation["workspace_id"],
                        user_id=user_data["id"],
                        role="member",
                        invited_by_user_id=invitation["invited_by_user_id"],
                        joined_at=now,
                    )
                )
                connection.execute(Session.__table__.insert().values(**session_data))
                accepted = connection.execute(
                    update(WorkspaceInvitation)
                    .where(
                        WorkspaceInvitation.id == invitation["id"],
                        WorkspaceInvitation.accepted_at.is_(None),
                    )
                    .values(accepted_at=now, accepted_by_user_id=user_data["id"])
                )
                if accepted.rowcount != 1:
                    raise ValueError("AUTH_INVITATION_INVALID")
                user_row = connection.execute(
                    select(User.__table__).where(User.id == user_data["id"])
                ).mappings().one()
                workspace_row = connection.execute(
                    select(Workspace.__table__).where(Workspace.id == workspace_data["id"])
                ).mappings().one()
                session_row = connection.execute(
                    select(Session.__table__).where(Session.id == session_data["id"])
                ).mappings().one()
        return InvitationRegistrationResult(
            user=_model_from_mapping(User, user_row),
            workspace=_model_from_mapping(Workspace, workspace_row),
            session=_model_from_mapping(Session, session_row),
        )

    def accept_invitation(
        self,
        *,
        token_hash: str,
        user_id: str,
        email_normalized: str,
        now: float,
    ) -> WorkspaceAccess:
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                invitation = connection.execute(
                    select(WorkspaceInvitation.__table__).where(
                        WorkspaceInvitation.token_hash == token_hash,
                        WorkspaceInvitation.accepted_at.is_(None),
                        WorkspaceInvitation.revoked_at.is_(None),
                        WorkspaceInvitation.expires_at > now,
                    )
                ).mappings().first()
                if invitation is None:
                    raise ValueError("AUTH_INVITATION_INVALID")
                if invitation["email_normalized"] != email_normalized:
                    raise ValueError("AUTH_INVITATION_EMAIL_MISMATCH")
                connection.execute(
                    WorkspaceMembership.__table__.insert().prefix_with("OR IGNORE").values(
                        workspace_id=invitation["workspace_id"],
                        user_id=user_id,
                        role="member",
                        invited_by_user_id=invitation["invited_by_user_id"],
                        joined_at=now,
                    )
                )
                accepted = connection.execute(
                    update(WorkspaceInvitation)
                    .where(
                        WorkspaceInvitation.id == invitation["id"],
                        WorkspaceInvitation.accepted_at.is_(None),
                    )
                    .values(accepted_at=now, accepted_by_user_id=user_id)
                )
                if accepted.rowcount != 1:
                    raise ValueError("AUTH_INVITATION_INVALID")
                workspace_row = connection.execute(
                    select(Workspace.__table__).where(
                        Workspace.id == invitation["workspace_id"]
                    )
                ).mappings().one()
        return WorkspaceAccess(_model_from_mapping(Workspace, workspace_row), "member")

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
                connection.execute(
                    WorkspaceMembership.__table__.insert().values(
                        workspace_id=workspace_data["id"],
                        user_id=user_data["id"],
                        role="owner",
                        invited_by_user_id=None,
                        joined_at=now,
                    )
                )
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
        self,
        user_id: str,
        *,
        new_password_hash: str,
        now: float,
        revoke_reason: str = "password_change",
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
                    .values(revoked_at=now, revoke_reason=revoke_reason)
                )
        return int(result.rowcount or 0)


__all__ = [
    "AuthRepository",
    "InvitationRegistrationResult",
    "OwnerSetupResult",
    "RotateResult",
    "WorkspaceAccess",
]
