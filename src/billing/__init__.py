"""Credits billing: adjustable credit ratio, published price books, wallets, platform roles."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.engine import Engine

from .errors import BillingError
from .price_book import PriceBookAdmin, PriceBookRuntime, PublishResult
from .pricing import CreditRule, PriceBookSnapshot, PriceItem, Quote
from .roles import ROLES, RoleService
from .wallet import WalletService


@dataclass
class BillingServices:
    engine: Engine
    roles: RoleService
    price_admin: PriceBookAdmin
    runtime: PriceBookRuntime
    wallets: WalletService

    @classmethod
    def build(cls, engine: Engine) -> "BillingServices":
        return cls(engine, RoleService(engine), PriceBookAdmin(engine), PriceBookRuntime(engine), WalletService(engine))


__all__ = [
    "BillingError", "BillingServices", "CreditRule", "PriceBookAdmin", "PriceBookRuntime", "PriceBookSnapshot",
    "PriceItem", "PublishResult", "Quote", "ROLES", "RoleService", "WalletService",
]
