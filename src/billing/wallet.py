"""Wallets and the append-only credit ledger.

Every mutation carries an idempotency key, so payment callbacks, retried holds and
double-clicked transfers never post twice. Holds freeze credits inside ``balance``;
``settle`` charges the actual amount and releases the remainder, ``release`` returns
everything. SQLite serialises writers with ``BEGIN IMMEDIATE``; MySQL uses row locks
via ``SELECT ... FOR UPDATE`` on the wallet row.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.engine import Connection, Engine

from ..storage.db import begin_immediate
from ..storage.dialect import is_sqlite
from ..storage.schema import CreditLedger, Wallet
from .errors import BillingError
from .pricing import Quote

CREDIT_TYPES = ("purchase", "grant", "adjust")


class WalletService:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    # ---- lookup ---------------------------------------------------------
    def get_or_create(self, owner_type: str, owner_id: str) -> dict[str, Any]:
        table = Wallet.__table__
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                row = connection.execute(
                    select(table).where(table.c.owner_type == owner_type, table.c.owner_id == owner_id)
                ).mappings().first()
                if row is None:
                    now = time.time()
                    wallet_id = str(uuid.uuid4())
                    connection.execute(table.insert().values(
                        id=wallet_id, owner_type=owner_type, owner_id=owner_id, balance=0, frozen=0,
                        created_at=now, updated_at=now))
                    row = connection.execute(select(table).where(table.c.id == wallet_id)).mappings().first()
        return dict(row)

    def for_workspace(self, workspace_id: str) -> dict[str, Any]:
        return self.get_or_create("workspace", workspace_id)

    def balance(self, wallet_id: str) -> dict[str, int]:
        table = Wallet.__table__
        with self.engine.connect() as connection:
            row = connection.execute(select(table.c.balance, table.c.frozen).where(table.c.id == wallet_id)).first()
        if row is None:
            raise BillingError("WALLET_NOT_FOUND", wallet_id, status_code=404)
        return {"balance": row.balance, "frozen": row.frozen, "available": row.balance - row.frozen}

    def ledger(self, wallet_id: str, limit: int = 50, before: float | None = None) -> list[dict[str, Any]]:
        table = CreditLedger.__table__
        query = select(table).where(table.c.wallet_id == wallet_id)
        if before is not None:
            query = query.where(table.c.created_at < before)
        with self.engine.connect() as connection:
            rows = connection.execute(query.order_by(table.c.created_at.desc()).limit(limit)).mappings().all()
        return [dict(row) for row in rows]

    # ---- core posting ---------------------------------------------------
    def _post(self, connection: Connection, wallet_id: str, type_: str, amount: int, idempotency_key: str, *,
              d_balance: int, d_frozen: int, job_item_id: str | None = None, actor_user_id: str | None = None,
              reason: str = "", quote: Quote | None = None) -> bool:
        ledger = CreditLedger.__table__
        wallets = Wallet.__table__
        if connection.execute(select(ledger.c.id).where(ledger.c.idempotency_key == idempotency_key)).first():
            return False
        query = select(wallets.c.balance, wallets.c.frozen).where(wallets.c.id == wallet_id)
        if not is_sqlite(connection):
            query = query.with_for_update()
        row = connection.execute(query).first()
        if row is None:
            raise BillingError("WALLET_NOT_FOUND", wallet_id, status_code=404)
        balance, frozen = row.balance + d_balance, row.frozen + d_frozen
        if balance < 0 or frozen < 0 or frozen > balance:
            raise BillingError("INSUFFICIENT_CREDITS", "积分不足", status_code=402)
        now = time.time()
        connection.execute(wallets.update().where(wallets.c.id == wallet_id).values(
            balance=balance, frozen=frozen, updated_at=now))
        connection.execute(ledger.insert().values(
            id=str(uuid.uuid4()), wallet_id=wallet_id, type=type_, amount=amount, balance_after=balance,
            frozen_after=frozen, job_item_id=job_item_id, idempotency_key=idempotency_key,
            price_book_version=quote.price_book_version if quote else None,
            item_id=quote.item_id if quote else None, unit_credits=quote.unit_credits if quote else None,
            quantity=quote.quantity if quote else None, actor_user_id=actor_user_id, reason=reason, created_at=now))
        return True

    # ---- funding --------------------------------------------------------
    def credit(self, wallet_id: str, amount: int, type_: str, idempotency_key: str, *,
               actor_user_id: str | None = None, reason: str = "") -> bool:
        """purchase / grant add credits; adjust may be negative (root, with a reason)."""
        if type_ not in CREDIT_TYPES:
            raise BillingError("LEDGER_TYPE_INVALID", type_)
        if amount == 0 or (type_ != "adjust" and amount < 0):
            raise BillingError("AMOUNT_INVALID", "金额必须为正")
        if type_ == "adjust" and not reason.strip():
            raise BillingError("REASON_REQUIRED", "手工调账必须填写原因", status_code=422)
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                return self._post(connection, wallet_id, type_, amount, idempotency_key,
                                  d_balance=amount, d_frozen=0, actor_user_id=actor_user_id, reason=reason)

    def transfer(self, from_wallet_id: str, to_wallet_id: str, amount: int, idempotency_key: str, *,
                 actor_user_id: str | None, reason: str = "") -> bool:
        if amount <= 0:
            raise BillingError("AMOUNT_INVALID", "金额必须为正")
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                posted = self._post(connection, from_wallet_id, "transfer_out", -amount, idempotency_key + ":out",
                                    d_balance=-amount, d_frozen=0, actor_user_id=actor_user_id, reason=reason)
                self._post(connection, to_wallet_id, "transfer_in", amount, idempotency_key + ":in",
                           d_balance=amount, d_frozen=0, actor_user_id=actor_user_id, reason=reason)
                return posted

    # ---- job lifecycle --------------------------------------------------
    # The *_in variants run on a caller-owned connection so the job item write and the
    # ledger write commit (or roll back) together.
    def hold_in(self, connection: Connection, wallet_id: str, job_item_id: str, quote: Quote, *,
                actor_user_id: str | None = None) -> bool:
        if quote.credits <= 0:
            return False
        return self._post(connection, wallet_id, "hold", -quote.credits, f"{job_item_id}:hold",
                          d_balance=0, d_frozen=quote.credits, job_item_id=job_item_id,
                          actor_user_id=actor_user_id, quote=quote)

    def hold(self, wallet_id: str, job_item_id: str, quote: Quote, *, actor_user_id: str | None = None) -> bool:
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                return self.hold_in(connection, wallet_id, job_item_id, quote, actor_user_id=actor_user_id)

    def _held_amount(self, connection: Connection, job_item_id: str) -> tuple[str, int] | None:
        ledger = CreditLedger.__table__
        row = connection.execute(
            select(ledger.c.wallet_id, ledger.c.amount).where(ledger.c.idempotency_key == f"{job_item_id}:hold")
        ).first()
        return (row.wallet_id, -row.amount) if row else None

    def settle_in(self, connection: Connection, job_item_id: str, actual: Quote | None = None) -> bool:
        """Charge the actual quote (capped at the held amount) and release the rest. No hold -> no-op."""
        held = self._held_amount(connection, job_item_id)
        if held is None:
            return False
        wallet_id, frozen = held
        charge = min(actual.credits, frozen) if actual is not None else frozen
        return self._post(connection, wallet_id, "settle", -charge, f"{job_item_id}:settle",
                          d_balance=-charge, d_frozen=-frozen, job_item_id=job_item_id, quote=actual)

    def settle(self, job_item_id: str, actual: Quote | None = None) -> bool:
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                return self.settle_in(connection, job_item_id, actual)

    def release_in(self, connection: Connection, job_item_id: str, *, reason: str = "failed") -> bool:
        held = self._held_amount(connection, job_item_id)
        if held is None:
            return False
        wallet_id, frozen = held
        return self._post(connection, wallet_id, "release", frozen, f"{job_item_id}:release",
                          d_balance=0, d_frozen=-frozen, job_item_id=job_item_id, reason=reason)

    def release(self, job_item_id: str, *, reason: str = "failed") -> bool:
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                return self.release_in(connection, job_item_id, reason=reason)

    def debit(self, wallet_id: str, quote: Quote, idempotency_key: str, *, cap_to_available: bool = True,
              reason: str = "") -> int:
        """Immediate charge for post-paid usage (LLM tokens). Returns the credits actually charged."""
        if quote.credits <= 0:
            return 0
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                charge = quote.credits
                if cap_to_available:
                    wallets = Wallet.__table__
                    row = connection.execute(select(wallets.c.balance, wallets.c.frozen).where(wallets.c.id == wallet_id)).first()
                    if row is None:
                        raise BillingError("WALLET_NOT_FOUND", wallet_id, status_code=404)
                    charge = max(0, min(charge, row.balance - row.frozen))
                if charge == 0:
                    return 0
                posted = self._post(connection, wallet_id, "settle", -charge, idempotency_key,
                                    d_balance=-charge, d_frozen=0, reason=reason, quote=quote)
                return charge if posted else 0


__all__ = ["WalletService", "CREDIT_TYPES"]
