"""Platform roles: root (everything), admin (read-only operations), reseller_admin (own reseller tree)."""

from __future__ import annotations

import time

from sqlalchemy import select
from sqlalchemy.engine import Engine

from ..storage.db import begin_immediate
from ..storage.schema import PlatformRole
from .errors import BillingError

ROLES = ("root", "admin", "reseller_admin")


class RoleService:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def role_of(self, user_id: str) -> str | None:
        with self.engine.connect() as connection:
            return connection.execute(
                select(PlatformRole.role).where(PlatformRole.user_id == user_id)
            ).scalar_one_or_none()

    def list_roles(self) -> list[dict[str, object]]:
        with self.engine.connect() as connection:
            rows = connection.execute(select(PlatformRole.__table__).order_by(PlatformRole.granted_at)).mappings().all()
        return [dict(row) for row in rows]

    def require(self, user_id: str, *allowed: str) -> str:
        role = self.role_of(user_id)
        if role not in allowed:
            raise BillingError("BILLING_FORBIDDEN", "需要 " + "/".join(allowed) + " 权限", status_code=403)
        return role

    def grant(self, user_id: str, role: str, *, by_user_id: str | None) -> None:
        if role not in ROLES:
            raise BillingError("ROLE_INVALID", f"未知角色 {role}")
        table = PlatformRole.__table__
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                existing = connection.execute(select(table.c.role).where(table.c.user_id == user_id)).scalar_one_or_none()
                values = {"role": role, "granted_by_user_id": by_user_id, "granted_at": time.time()}
                if existing is None:
                    connection.execute(table.insert().values(user_id=user_id, **values))
                else:
                    connection.execute(table.update().where(table.c.user_id == user_id).values(**values))

    def revoke(self, user_id: str) -> None:
        table = PlatformRole.__table__
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                role = connection.execute(select(table.c.role).where(table.c.user_id == user_id)).scalar_one_or_none()
                if role is None:
                    return
                if role == "root":
                    others = connection.execute(
                        select(table.c.user_id).where(table.c.role == "root", table.c.user_id != user_id)
                    ).first()
                    if others is None:
                        raise BillingError("ROLE_LAST_ROOT", "不能移除最后一个 root", status_code=409)
                connection.execute(table.delete().where(table.c.user_id == user_id))

    def bootstrap_root(self, user_id: str) -> bool:
        """Grant root to ``user_id`` only while the platform has no root yet."""
        table = PlatformRole.__table__
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                if connection.execute(select(table.c.user_id).where(table.c.role == "root")).first() is not None:
                    return False
                connection.execute(table.insert().values(
                    user_id=user_id, role="root", granted_by_user_id=None, granted_at=time.time()))
                return True


__all__ = ["ROLES", "RoleService"]
