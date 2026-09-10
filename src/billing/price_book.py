"""Price book administration (draft -> publish -> versioned snapshot) and runtime quoting."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.engine import Connection, Engine

from ..storage.db import begin_immediate
from ..storage.schema import PriceBookVersion, PricingItem, PricingSettings
from .errors import BillingError
from .pricing import CreditRule, PriceBookSnapshot, PriceItem, Quote

SETTINGS_ID = "current"


@dataclass
class PublishResult:
    version: int
    item_count: int
    changes: list[dict[str, Any]]


def _item_from_row(row: Any) -> PriceItem:
    return PriceItem(
        item_id=row["item_id"], model_id=row["model_id"], stage=row["stage"], billing_unit=row["billing_unit"],
        match=json.loads(row["match_json"]), purchase_price_cny=row["purchase_price_cny"],
        multiplier=row["multiplier"], credits_override=row["credits_override"],
        display_name=row["display_name"], enabled=bool(row["enabled"]),
    )


def _item_from_snapshot(entry: dict[str, Any]) -> PriceItem:
    return PriceItem(
        item_id=entry["item_id"], model_id=entry["model_id"], stage=entry["stage"], billing_unit=entry["billing_unit"],
        match=entry["match"], purchase_price_cny=entry["purchase_price_cny"], multiplier=entry["multiplier"],
        credits_override=entry["credits_override"], display_name=entry["display_name"], enabled=entry["enabled"],
    )


class PriceBookAdmin:
    """Root-facing operations. Drafts live in pricing_settings/pricing_items; publish() freezes them."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    # ---- rule -----------------------------------------------------------
    def get_rule(self) -> CreditRule:
        with self.engine.connect() as connection:
            row = connection.execute(
                select(PricingSettings.__table__).where(PricingSettings.id == SETTINGS_ID)
            ).mappings().first()
        if row is None:
            return CreditRule()
        return CreditRule(row["credit_face_value_cny"], row["l1_discount"], row["target_markup"],
                          row["rounding_step"], row["min_credits"])

    def update_rule(self, by_user_id: str | None, **changes: Any) -> CreditRule:
        try:
            rule = CreditRule(**{**self.get_rule().to_dict(), **changes})
        except ValueError as exc:
            raise BillingError("PRICING_RULE_INVALID", str(exc), status_code=422) from exc
        table = PricingSettings.__table__
        values = {**rule.to_dict(), "updated_by_user_id": by_user_id, "updated_at": time.time()}
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                exists = connection.execute(select(table.c.id).where(table.c.id == SETTINGS_ID)).first()
                if exists is None:
                    connection.execute(table.insert().values(id=SETTINGS_ID, **values))
                else:
                    connection.execute(table.update().where(table.c.id == SETTINGS_ID).values(**values))
        return rule

    # ---- items ----------------------------------------------------------
    @staticmethod
    def make_item_id(model_id: str, match: dict[str, Any]) -> str:
        spec = ",".join(f"{key}={match[key]}" for key in sorted(match)) or "default"
        return f"{model_id}|{spec}"

    def upsert_item(self, by_user_id: str | None, *, model_id: str, stage: str, billing_unit: str,
                    match: dict[str, Any], purchase_price_cny: float, multiplier: float = 1.0,
                    credits_override: int | None = None, display_name: str = "", enabled: bool = True) -> dict[str, Any]:
        if stage not in ("text", "image", "video", "tts"):
            raise BillingError("PRICING_STAGE_INVALID", f"未知阶段 {stage}", status_code=422)
        if purchase_price_cny < 0 or multiplier <= 0:
            raise BillingError("PRICING_ITEM_INVALID", "进货价不能为负，系数必须大于 0", status_code=422)
        item_id = self.make_item_id(model_id, match)
        table = PricingItem.__table__
        values = {
            "model_id": model_id, "stage": stage, "billing_unit": billing_unit,
            "match_json": json.dumps(match, ensure_ascii=False, sort_keys=True),
            "purchase_price_cny": purchase_price_cny, "multiplier": multiplier, "credits_override": credits_override,
            "display_name": display_name, "enabled": int(enabled),
            "updated_by_user_id": by_user_id, "updated_at": time.time(),
        }
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                exists = connection.execute(select(table.c.item_id).where(table.c.item_id == item_id)).first()
                if exists is None:
                    connection.execute(table.insert().values(item_id=item_id, **values))
                else:
                    connection.execute(table.update().where(table.c.item_id == item_id).values(**values))
        return self.preview_item(item_id)

    def delete_item(self, item_id: str) -> bool:
        table = PricingItem.__table__
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                result = connection.execute(table.delete().where(table.c.item_id == item_id))
                return bool(result.rowcount)

    def _draft_items(self, connection: Connection) -> list[PriceItem]:
        rows = connection.execute(
            select(PricingItem.__table__).order_by(PricingItem.stage, PricingItem.model_id, PricingItem.item_id)
        ).mappings().all()
        return [_item_from_row(row) for row in rows]

    def preview(self, purchase_price_cny: float, multiplier: float = 1.0, credits_override: int | None = None) -> dict[str, Any]:
        try:
            return self.get_rule().preview(purchase_price_cny, multiplier, credits_override)
        except ValueError as exc:
            raise BillingError("PRICING_ITEM_INVALID", str(exc), status_code=422) from exc

    def preview_item(self, item_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = connection.execute(select(PricingItem.__table__).where(PricingItem.item_id == item_id)).mappings().first()
        if row is None:
            raise BillingError("PRICING_ITEM_NOT_FOUND", item_id, status_code=404)
        item = _item_from_row(row)
        return {**self.preview(item.purchase_price_cny, item.multiplier, item.credits_override),
                "item_id": item.item_id, "model_id": item.model_id, "stage": item.stage, "unit": item.billing_unit,
                "match": item.match, "display_name": item.display_name, "enabled": item.enabled}

    def draft_table(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            items = self._draft_items(connection)
        snapshot = PriceBookSnapshot(0, self.get_rule(), items)
        # include disabled rows too so the admin table shows everything
        rows = snapshot.table()
        enabled_ids = {row["item_id"] for row in rows}
        rule = self.get_rule()
        for item in items:
            if item.item_id not in enabled_ids:
                rows.append({**rule.preview(item.purchase_price_cny, item.multiplier, item.credits_override),
                             "item_id": item.item_id, "model_id": item.model_id, "stage": item.stage,
                             "unit": item.billing_unit, "match": item.match, "display_name": item.display_name,
                             "enabled": False})
        for row in rows:
            row.setdefault("enabled", True)
        return rows

    # ---- publish --------------------------------------------------------
    def publish(self, by_user_id: str | None, *, note: str = "", effective_at: float | None = None) -> PublishResult:
        rule = self.get_rule()
        table = PriceBookVersion.__table__
        with self.engine.connect() as connection:
            with begin_immediate(connection):
                items = self._draft_items(connection)
                snapshot = PriceBookSnapshot(0, rule, items)
                below = snapshot.validate()
                if below:
                    raise BillingError(
                        "PRICING_MARGIN_BELOW_TARGET",
                        f"以下计费项对一级经销商利润率低于 {rule.target_markup:.0%}，不能发布：{below}",
                        status_code=422,
                    )
                previous = connection.execute(
                    select(table.c.items_json).order_by(table.c.version.desc()).limit(1)
                ).scalar_one_or_none()
                previous_credits = {e["item_id"]: e["credits"] for e in json.loads(previous)} if previous else {}
                payload = [{
                    "item_id": i.item_id, "model_id": i.model_id, "stage": i.stage, "billing_unit": i.billing_unit,
                    "match": i.match, "purchase_price_cny": i.purchase_price_cny, "multiplier": i.multiplier,
                    "credits_override": i.credits_override, "display_name": i.display_name, "enabled": i.enabled,
                    "credits": i.credits(rule),
                } for i in items]
                now = time.time()
                result = connection.execute(table.insert().values(
                    rule_json=json.dumps(rule.to_dict()), items_json=json.dumps(payload, ensure_ascii=False),
                    note=note, published_by_user_id=by_user_id, published_at=now, effective_at=effective_at or now,
                ))
                version = int(result.inserted_primary_key[0])
        changes = [{"item_id": p["item_id"], "before": previous_credits.get(p["item_id"]), "after": p["credits"]}
                   for p in payload if previous_credits.get(p["item_id"]) != p["credits"]]
        return PublishResult(version, len(payload), changes)

    def list_versions(self, limit: int = 20) -> list[dict[str, Any]]:
        table = PriceBookVersion.__table__
        with self.engine.connect() as connection:
            rows = connection.execute(select(table).order_by(table.c.version.desc()).limit(limit)).mappings().all()
        return [{"version": r["version"], "note": r["note"], "published_by_user_id": r["published_by_user_id"],
                 "published_at": r["published_at"], "effective_at": r["effective_at"],
                 "rule": json.loads(r["rule_json"]), "item_count": len(json.loads(r["items_json"]))} for r in rows]

    def rollback(self, by_user_id: str | None, version: int) -> PublishResult:
        """Copy a historical version back into the draft and publish it as a new version."""
        table = PriceBookVersion.__table__
        items_table = PricingItem.__table__
        with self.engine.connect() as connection:
            row = connection.execute(select(table).where(table.c.version == version)).mappings().first()
            if row is None:
                raise BillingError("PRICING_VERSION_NOT_FOUND", str(version), status_code=404)
            with begin_immediate(connection):
                connection.execute(items_table.delete())
                now = time.time()
                for entry in json.loads(row["items_json"]):
                    connection.execute(items_table.insert().values(
                        item_id=entry["item_id"], model_id=entry["model_id"], stage=entry["stage"],
                        billing_unit=entry["billing_unit"],
                        match_json=json.dumps(entry["match"], ensure_ascii=False, sort_keys=True),
                        purchase_price_cny=entry["purchase_price_cny"], multiplier=entry["multiplier"],
                        credits_override=entry["credits_override"], display_name=entry["display_name"],
                        enabled=int(entry["enabled"]), updated_by_user_id=by_user_id, updated_at=now,
                    ))
        self.update_rule(by_user_id, **json.loads(row["rule_json"]))
        return self.publish(by_user_id, note=f"rollback to v{version}")


class PriceBookRuntime:
    """Quotes against the currently effective published version, with a short cache."""

    def __init__(self, engine: Engine, cache_ttl: float = 5.0) -> None:
        self.engine = engine
        self.cache_ttl = cache_ttl
        self._snapshot: PriceBookSnapshot | None = None
        self._loaded_at = 0.0

    def _load(self, version: int | None = None) -> PriceBookSnapshot | None:
        table = PriceBookVersion.__table__
        with self.engine.connect() as connection:
            if version is None:
                row = connection.execute(
                    select(table).where(table.c.effective_at <= time.time()).order_by(table.c.version.desc()).limit(1)
                ).mappings().first()
            else:
                row = connection.execute(select(table).where(table.c.version == version)).mappings().first()
        if row is None:
            return None
        rule = CreditRule(**json.loads(row["rule_json"]))
        items = [_item_from_snapshot(entry) for entry in json.loads(row["items_json"])]
        return PriceBookSnapshot(row["version"], rule, items)

    def invalidate(self) -> None:
        self._snapshot, self._loaded_at = None, 0.0

    def current(self) -> PriceBookSnapshot | None:
        """The effective price book, or None when nothing has been published yet."""
        if self._snapshot is None or time.time() - self._loaded_at > self.cache_ttl:
            self._snapshot, self._loaded_at = self._load(), time.time()
        return self._snapshot

    def require_current(self) -> PriceBookSnapshot:
        snapshot = self.current()
        if snapshot is None:
            raise BillingError("PRICE_BOOK_MISSING", "尚未发布任何积分表", status_code=503)
        return snapshot

    def at_version(self, version: int) -> PriceBookSnapshot:
        snapshot = self._load(version)
        if snapshot is None:
            raise BillingError("PRICING_VERSION_NOT_FOUND", str(version), status_code=404)
        return snapshot

    def quote(self, model_id: str, params: dict[str, Any], quantity: float = 1.0) -> Quote:
        try:
            return self.require_current().quote(model_id, params, quantity)
        except KeyError as exc:
            raise BillingError("PRICING_ITEM_NOT_FOUND", f"没有 {model_id} {params} 的积分定价", status_code=422) from exc

    def quote_text(self, model_id: str, tokens_in: int, tokens_out: int) -> Quote:
        try:
            return self.require_current().quote_text(model_id, tokens_in, tokens_out)
        except KeyError as exc:
            raise BillingError("PRICING_ITEM_NOT_FOUND", f"没有 {model_id} 的积分定价", status_code=422) from exc


__all__ = ["PriceBookAdmin", "PriceBookRuntime", "PublishResult", "SETTINGS_ID"]
