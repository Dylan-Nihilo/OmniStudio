"""
Credit-ratio arithmetic (pure functions, no IO).

    积分 = ⌈ 进货价(元) × 积分比例 × 单项系数 ⌉
    积分比例(每元多少积分) = (1 + 目标利润率) ÷ 一级折扣 ÷ 积分标价

三个参数由 root 在后台调整；改任何一个，全表按同一公式重算。
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class CreditRule:
    credit_face_value_cny: float = 0.10   # 1 积分标价（元）
    l1_discount: float = 0.50             # 一级经销商进货折扣
    target_markup: float = 1.20           # 对一级经销商的利润率（相对进货价）
    rounding_step: int = 1                # 积分取整步长
    min_credits: int = 1                  # 单次最低积分

    def __post_init__(self) -> None:
        if not 0 < self.credit_face_value_cny:
            raise ValueError("credit_face_value_cny must be > 0")
        if not 0 < self.l1_discount <= 1:
            raise ValueError("l1_discount must be in (0, 1]")
        if self.target_markup < 0:
            raise ValueError("target_markup must be >= 0")
        if self.rounding_step < 1 or self.min_credits < 1:
            raise ValueError("rounding_step / min_credits must be >= 1")

    @property
    def credits_per_yuan(self) -> float:
        """积分比例：进货价 1 元 = 多少积分。默认 (1+1.2)/0.5/0.1 = 44"""
        return (1 + self.target_markup) / self.l1_discount / self.credit_face_value_cny

    @property
    def l1_price_per_credit(self) -> float:
        return self.credit_face_value_cny * self.l1_discount

    def credits_for_price(self, price_cny: float, multiplier: float = 1.0) -> int:
        if price_cny < 0 or multiplier <= 0:
            raise ValueError("price must be >= 0 and multiplier > 0")
        raw = price_cny * self.credits_per_yuan * multiplier
        stepped = math.ceil(raw / self.rounding_step - 1e-9) * self.rounding_step
        return max(int(stepped), self.min_credits)

    def markup_for(self, price_cny: float, credits: int) -> float:
        """给定进货价与积分，算对一级经销商的真实利润率"""
        if price_cny <= 0:
            return float("inf")
        return credits * self.l1_price_per_credit / price_cny - 1

    def preview(self, price_cny: float, multiplier: float = 1.0, credits_override: int | None = None) -> dict[str, Any]:
        """后台“输入进货价 → 看积分”的即时预览"""
        credits = credits_override if credits_override is not None else self.credits_for_price(price_cny, multiplier)
        return {
            "purchase_price_cny": price_cny,
            "credits_per_yuan": round(self.credits_per_yuan, 4),
            "multiplier": multiplier,
            "credits": credits,
            "list_price_cny": round(credits * self.credit_face_value_cny, 4),
            "l1_price_cny": round(credits * self.l1_price_per_credit, 4),
            "markup_vs_purchase": round(self.markup_for(price_cny, credits), 4),
            "meets_target": self.markup_for(price_cny, credits) >= self.target_markup - 1e-9,
        }

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PriceItem:
    """一个计费项 = 模型 canonical mode id + 规格匹配条件"""
    item_id: str                          # 稳定主键，如 "seedance/seedance-2.0-video#i2v|1080p"
    model_id: str                         # 模型目录 canonical mode id，文本/TTS 用 text/*, tts/*
    stage: str                            # text | image | video | tts
    billing_unit: str                     # second | image | token_1m | chars_10k
    match: dict[str, Any]                 # 请求参数需满足的条件，如 {"resolution": "1080p"}
    purchase_price_cny: float             # root 输入的进货价（每计费单位）
    multiplier: float = 1.0               # 单项系数（促销 0.8、新模型 1.2 等），默认 1
    credits_override: int | None = None   # 手工指定积分；发布时仍需通过利润率校验
    display_name: str = ""
    enabled: bool = True

    def credits(self, rule: CreditRule) -> int:
        return self.credits_override if self.credits_override is not None else rule.credits_for_price(
            self.purchase_price_cny, self.multiplier)


@dataclass
class Quote:
    item_id: str
    unit_credits: int
    quantity: float
    credits: int
    price_book_version: int
    breakdown: dict[str, Any] = field(default_factory=dict)


class PriceBookSnapshot:
    """一个已发布版本：不可变，运行时用它报价"""

    def __init__(self, version: int, rule: CreditRule, items: list[PriceItem]):
        self.version, self.rule = version, rule
        self.items = {i.item_id: i for i in items if i.enabled}
        self._by_model: dict[str, list[PriceItem]] = {}
        for i in self.items.values():
            self._by_model.setdefault(i.model_id, []).append(i)

    def validate(self) -> list[str]:
        """返回不满足目标利润率的项（发布前必须为空）"""
        bad = []
        for i in self.items.values():
            if self.rule.markup_for(i.purchase_price_cny, i.credits(self.rule)) < self.rule.target_markup - 1e-9:
                bad.append(i.item_id)
        return bad

    def find(self, model_id: str, params: dict[str, Any]) -> PriceItem:
        cands = [i for i in self._by_model.get(model_id, ())
                 if all(params.get(k) == v for k, v in i.match.items())]
        if not cands:
            raise KeyError(f"no price item for {model_id} {params}")
        return max(cands, key=lambda i: len(i.match))      # 最具体的匹配优先

    def quote(self, model_id: str, params: dict[str, Any], quantity: float = 1.0) -> Quote:
        item = self.find(model_id, params)
        uc = item.credits(self.rule)
        return Quote(item.item_id, uc, quantity, math.ceil(uc * quantity - 1e-9), self.version,
                     {"billing_unit": item.billing_unit})

    def quote_text(self, model_id: str, tokens_in: int, tokens_out: int) -> Quote:
        q_in = self.quote(model_id, {"direction": "in"}, tokens_in / 1_000_000)
        q_out = self.quote(model_id, {"direction": "out"}, tokens_out / 1_000_000)
        raw = q_in.unit_credits * q_in.quantity + q_out.unit_credits * q_out.quantity
        return Quote(q_in.item_id, q_in.unit_credits, tokens_in + tokens_out,
                     max(math.ceil(raw - 1e-9), self.rule.min_credits), self.version,
                     {"tokens_in": tokens_in, "tokens_out": tokens_out})

    def table(self) -> list[dict[str, Any]]:
        """给后台/前端展示的完整积分表"""
        return [{**self.rule.preview(i.purchase_price_cny, i.multiplier, i.credits_override),
                 "item_id": i.item_id, "model_id": i.model_id, "stage": i.stage, "unit": i.billing_unit,
                 "match": i.match, "display_name": i.display_name} for i in self.items.values()]
