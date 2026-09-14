"""Billing HTTP routes: user-facing wallet/quote endpoints and the root/admin console API."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from ..apps.comic_gen.audit import record_request_event
from ..apps.comic_gen.auth.dependencies import get_current_user
from ..apps.comic_gen.auth.service import AuthContext
from . import BillingServices
from .errors import BillingError
from .metering import billing_enabled


def get_billing(request: Request) -> BillingServices:
    services = getattr(request.app.state, "billing", None)
    if services is None:
        engine = getattr(request.app.state, "storage_engine", None)
        if engine is None:
            raise BillingError("BILLING_UNAVAILABLE", "计费服务未初始化", status_code=503)
        services = BillingServices.build(engine)
        request.app.state.billing = services
    return services


def billing_exception_handler(request: Request, exc: BillingError) -> JSONResponse:
    request_id = str(getattr(request.state, "request_id", "") or f"req_{uuid.uuid4().hex}")
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message, "request_id": request_id}},
        headers={"Cache-Control": "no-store"},
    )


CurrentUser = Annotated[AuthContext, Depends(get_current_user)]
Billing = Annotated[BillingServices, Depends(get_billing)]


def require_roles(*roles: str):
    def dependency(context: CurrentUser, billing: Billing) -> AuthContext:
        billing.roles.require(context.user.id, *roles)
        return context
    return dependency


RootUser = Annotated[AuthContext, Depends(require_roles("root"))]
AdminUser = Annotated[AuthContext, Depends(require_roles("root", "admin"))]


# ============================================================ user-facing
router = APIRouter(prefix="/billing", tags=["billing"])


class QuoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str
    params: dict[str, Any] = Field(default_factory=dict)
    quantity: float = Field(default=1.0, gt=0)


@router.get("/wallet")
def wallet(context: CurrentUser, billing: Billing) -> dict[str, Any]:
    """Balance plus whether this deployment bills at all, so the UI can hide itself.

    Admins still get their role while billing is off: that is how root reaches the console
    to set prices up before switching OMNI_STUDIO_BILLING_ENABLED on.
    """
    role = billing.roles.role_of(context.user.id)
    enabled = billing_enabled()
    if not enabled and role not in ("root", "admin"):
        return {"enabled": False, "role": None}
    w = billing.wallets.for_workspace(context.workspace.id)
    return {"enabled": enabled, "wallet_id": w["id"], "workspace_id": context.workspace.id,
            **billing.wallets.balance(w["id"]), "role": role}


@router.get("/ledger")
def ledger(context: CurrentUser, billing: Billing, limit: int = 50, before: float | None = None) -> dict[str, Any]:
    w = billing.wallets.for_workspace(context.workspace.id)
    return {"wallet_id": w["id"], "entries": billing.wallets.ledger(w["id"], limit=min(max(limit, 1), 200), before=before)}


@router.post("/quote")
def quote(body: QuoteRequest, context: CurrentUser, billing: Billing) -> dict[str, Any]:
    q = billing.runtime.quote(body.model_id, body.params, body.quantity)
    return {"item_id": q.item_id, "unit_credits": q.unit_credits, "quantity": q.quantity, "credits": q.credits,
            "price_book_version": q.price_book_version}


@router.get("/pricing-table")
def pricing_table(context: CurrentUser, billing: Billing) -> dict[str, Any]:
    """Effective credits per model/spec for the model selector; purchase prices are never exposed."""
    snapshot = billing.runtime.require_current()
    rows = [{"item_id": row["item_id"], "model_id": row["model_id"], "stage": row["stage"], "unit": row["unit"],
             "match": row["match"], "credits": row["credits"], "display_name": row["display_name"]}
            for row in snapshot.table()]
    return {"version": snapshot.version, "credit_face_value_cny": snapshot.rule.credit_face_value_cny, "items": rows}


# ============================================================ admin console
admin_router = APIRouter(prefix="/admin", tags=["admin"])


class RuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credit_face_value_cny: float | None = Field(default=None, gt=0)
    l1_discount: float | None = Field(default=None, gt=0, le=1)
    target_markup: float | None = Field(default=None, ge=0)
    rounding_step: int | None = Field(default=None, ge=1)
    min_credits: int | None = Field(default=None, ge=1)


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    purchase_price_cny: float = Field(ge=0)
    multiplier: float = Field(default=1.0, gt=0)
    credits_override: int | None = None


class ItemUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str = Field(min_length=1, max_length=200)
    stage: str
    billing_unit: str = Field(min_length=1, max_length=32)
    match: dict[str, Any] = Field(default_factory=dict)
    purchase_price_cny: float = Field(ge=0)
    multiplier: float = Field(default=1.0, gt=0)
    credits_override: int | None = None
    display_name: str = Field(default="", max_length=200)
    enabled: bool = True


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str = Field(default="", max_length=500)
    effective_at: float | None = None


class RoleGrant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    role: str


class WalletAdjust(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wallet_id: str
    amount: int
    reason: str = Field(min_length=2, max_length=500)


class WalletGrant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workspace_id: str
    amount: int = Field(gt=0)
    reason: str = Field(default="", max_length=500)
    idempotency_key: str | None = None


def _rule_payload(rule) -> dict[str, Any]:
    return {**rule.to_dict(), "credits_per_yuan": rule.credits_per_yuan, "l1_price_per_credit": rule.l1_price_per_credit}


@admin_router.get("/pricing/rule")
def get_rule(context: AdminUser, billing: Billing) -> dict[str, Any]:
    return _rule_payload(billing.price_admin.get_rule())


@admin_router.put("/pricing/rule")
def update_rule(body: RuleUpdate, request: Request, context: RootUser, billing: Billing) -> dict[str, Any]:
    changes = {key: value for key, value in body.model_dump().items() if value is not None}
    rule = billing.price_admin.update_rule(context.user.id, **changes)
    record_request_event(request, action="pricing.rule.update", object_type="pricing", object_id="current", metadata=changes)
    return {**_rule_payload(rule), "draft_table": billing.price_admin.draft_table()}


@admin_router.post("/pricing/preview")
def preview(body: PreviewRequest, context: AdminUser, billing: Billing) -> dict[str, Any]:
    return billing.price_admin.preview(body.purchase_price_cny, body.multiplier, body.credits_override)


@admin_router.get("/pricing/items")
def list_items(context: AdminUser, billing: Billing) -> list[dict[str, Any]]:
    return billing.price_admin.draft_table()


@admin_router.put("/pricing/items")
def upsert_item(body: ItemUpsert, request: Request, context: RootUser, billing: Billing) -> dict[str, Any]:
    result = billing.price_admin.upsert_item(context.user.id, **body.model_dump())
    record_request_event(request, action="pricing.item.upsert", object_type="pricing_item", object_id=result["item_id"],
                         metadata={"purchase_price_cny": body.purchase_price_cny, "credits": result["credits"]})
    return result


@admin_router.put("/pricing/items/batch")
def upsert_items(body: list[ItemUpsert], request: Request, context: RootUser, billing: Billing) -> list[dict[str, Any]]:
    results = [billing.price_admin.upsert_item(context.user.id, **item.model_dump()) for item in body]
    record_request_event(request, action="pricing.item.batch", object_type="pricing_item", object_id="batch",
                         metadata={"count": len(results)})
    return results


@admin_router.delete("/pricing/items/{item_id:path}")
def delete_item(item_id: str, request: Request, context: RootUser, billing: Billing) -> dict[str, Any]:
    deleted = billing.price_admin.delete_item(item_id)
    if deleted:
        record_request_event(request, action="pricing.item.delete", object_type="pricing_item", object_id=item_id)
    return {"deleted": deleted}


@admin_router.post("/pricing/publish")
def publish(body: PublishRequest, request: Request, context: RootUser, billing: Billing) -> dict[str, Any]:
    result = billing.price_admin.publish(context.user.id, note=body.note, effective_at=body.effective_at)
    billing.runtime.invalidate()
    record_request_event(request, action="pricing.publish", object_type="price_book", object_id=str(result.version),
                         metadata={"item_count": result.item_count, "changed": len(result.changes)})
    return {"version": result.version, "item_count": result.item_count, "changes": result.changes}


@admin_router.get("/pricing/versions")
def versions(context: AdminUser, billing: Billing) -> list[dict[str, Any]]:
    return billing.price_admin.list_versions()


@admin_router.post("/pricing/versions/{version}/rollback")
def rollback(version: int, request: Request, context: RootUser, billing: Billing) -> dict[str, Any]:
    result = billing.price_admin.rollback(context.user.id, version)
    billing.runtime.invalidate()
    record_request_event(request, action="pricing.rollback", object_type="price_book", object_id=str(result.version),
                         metadata={"from_version": version})
    return {"version": result.version, "changes": result.changes}


@admin_router.get("/roles")
def list_roles(context: RootUser, billing: Billing) -> list[dict[str, Any]]:
    return billing.roles.list_roles()


@admin_router.put("/roles")
def grant_role(body: RoleGrant, request: Request, context: RootUser, billing: Billing) -> dict[str, Any]:
    billing.roles.grant(body.user_id, body.role, by_user_id=context.user.id)
    record_request_event(request, action="role.grant", object_type="user", object_id=body.user_id, metadata={"role": body.role})
    return {"user_id": body.user_id, "role": body.role}


@admin_router.delete("/roles/{user_id}")
def revoke_role(user_id: str, request: Request, context: RootUser, billing: Billing) -> dict[str, Any]:
    billing.roles.revoke(user_id)
    record_request_event(request, action="role.revoke", object_type="user", object_id=user_id)
    return {"user_id": user_id, "role": None}


@admin_router.get("/wallets/workspace/{workspace_id}")
def workspace_wallet(workspace_id: str, context: AdminUser, billing: Billing) -> dict[str, Any]:
    w = billing.wallets.for_workspace(workspace_id)
    return {"wallet_id": w["id"], "workspace_id": workspace_id, **billing.wallets.balance(w["id"]),
            "ledger": billing.wallets.ledger(w["id"])}


@admin_router.post("/wallets/grant")
def grant_credits(body: WalletGrant, request: Request, context: RootUser, billing: Billing) -> dict[str, Any]:
    """Manual top-up (e.g. offline payment) for a workspace."""
    w = billing.wallets.for_workspace(body.workspace_id)
    key = body.idempotency_key or f"grant:{uuid.uuid4()}"
    billing.wallets.credit(w["id"], body.amount, "grant", key, actor_user_id=context.user.id, reason=body.reason)
    record_request_event(request, action="wallet.grant", object_type="wallet", object_id=w["id"],
                         metadata={"amount": body.amount, "workspace_id": body.workspace_id})
    return {"wallet_id": w["id"], **billing.wallets.balance(w["id"])}


@admin_router.post("/wallets/adjust")
def adjust_credits(body: WalletAdjust, request: Request, context: RootUser, billing: Billing) -> dict[str, Any]:
    billing.wallets.credit(body.wallet_id, body.amount, "adjust", f"adjust:{uuid.uuid4()}",
                           actor_user_id=context.user.id, reason=body.reason)
    record_request_event(request, action="wallet.adjust", object_type="wallet", object_id=body.wallet_id,
                         metadata={"amount": body.amount})
    return {"wallet_id": body.wallet_id, **billing.wallets.balance(body.wallet_id)}


__all__ = ["router", "admin_router", "get_billing", "billing_exception_handler", "require_roles"]
