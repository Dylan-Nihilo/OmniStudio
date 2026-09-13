"""Generate config/pricing/price_book.seed.json from the supplier quotes.

Run it again whenever a quote changes; the numbers below are the only thing to edit.

Sources, agreed 2026-09-13:
  * Video — 轻舟万向国内大模型报价表 0821, sheet 「国模-视频生成0818」, discounted price of the
    channel we actually buy through: Seedance 2.0 字节厂商 (86折), Seedance 2.5 字节厂商 (85折),
    MiniMax Hailuo 2.3 自部署 (62折). Seedance modes all take image references, never a video,
    so every row uses the 「不含视频」 column.
  * Text — newapi list price (kaizo.top /api/pricing, model_ratio x $2 per 1M tokens) times our
    per-vendor multiplier. newapi settles its quota unit 1:1 against CNY, so a list price of
    "$5" times a 1.8 multiplier costs ¥9 per million tokens.
  * Image — our supplier's per-image cost, flat for the Gemini models and tiered by resolution
    for gpt-image-2.
  * Voice — 百炼 (DashScope) official price per 10k characters.

Video is quoted in CNY already; text and image need no FX because newapi bills 1 unit = ¥1.

Users are charged in one unit per stage — video per second, image per image, text and voice
per 1000 characters — and every rate is a whole number of credits, so a bill can be worked
out in your head. Rounding a rate up only adds margin, which is why the cheap tiers sit well
above the 120% target rather than at it.

Vendors bill text by token, so the per-character price assumes TOKENS_PER_CHAR below.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

SEED = Path(__file__).resolve().parents[1] / "config" / "pricing" / "price_book.seed.json"

RULE = {"credit_face_value_cny": 0.10, "l1_discount": 0.50, "target_markup": 1.20,
        "rounding_step": 1, "min_credits": 1}

# Seedance bills per million tokens; a second of video is width x height x 24fps / 1024 tokens.
TOKENS_PER_SECOND = {"480p": 854 * 480 * 24 // 1024, "720p": 1280 * 720 * 24 // 1024,
                     "1080p": 1920 * 1080 * 24 // 1024}


def per_second(cny_per_million_tokens: float, resolution: str) -> float:
    return cny_per_million_tokens * TOKENS_PER_SECOND[resolution] / 1_000_000


# --- video -----------------------------------------------------------------
# 折后价 元/百万 token, 不含视频输入
SEEDANCE_20 = {"720p": 39.56, "1080p": 43.86}
SEEDANCE_25 = {"480p": 59.50, "720p": 59.50}
# MiniMax Hailuo 2.3 is quoted directly in 元/秒 (自部署 62折)
MINIMAX = {"1K": 0.31, "2K": 0.496}      # catalog calls 768P "1K"

video: list[dict] = []
for mode in ("t2v", "i2v", "r2v"):
    for resolution, price in SEEDANCE_20.items():
        video.append({"model_id": f"seedance/seedance-2.0-video#{mode}", "stage": "video",
                      "billing_unit": "second", "match": {"resolution": resolution},
                      "purchase_price_cny": round(per_second(price, resolution), 4),
                      "display_name": "Seedance 2.0"})
    for resolution, price in SEEDANCE_25.items():
        video.append({"model_id": f"seedance/seedance-2.5-video#{mode}", "stage": "video",
                      "billing_unit": "second", "match": {"resolution": resolution},
                      "purchase_price_cny": round(per_second(price, resolution), 4),
                      "display_name": "Seedance 2.5"})
for resolution, price in MINIMAX.items():
    video.append({"model_id": "minimax/minimax-h3#i2v", "stage": "video", "billing_unit": "second",
                  "match": {"resolution": resolution}, "purchase_price_cny": price,
                  "display_name": "MiniMax Hailuo 2.3"})

# --- text -----------------------------------------------------------------
# Cost = newapi list price x the multiplier we are charged for that vendor's pool.
# Model ids must equal the name the LLM adapter sends upstream, i.e. the newapi model name.
TEXT_MULTIPLIER = {"deepseek": 0.6, "gemini": 0.8, "gpt": 0.8, "claude": 1.8}
# Vendors bill tokens, users are charged characters. Chinese runs 0.6-0.8 tokens per character
# on every tokenizer these models use, so 1.0 deliberately over-states it: we can never end up
# charging less than the tokens actually cost, and the gap is extra margin.
TOKENS_PER_CHAR = 1.0
TEXT = [
    # tier, newapi model name, vendor, list price in, list price out
    ("标准", "DeepSeek-V4.1-Flash", "deepseek", 1.5, 6.0),
    ("高级", "gemini-3.7-flash", "gemini", 1.5, 5.625),
    ("卓越", "gpt-5.6-sol", "gpt", 5.0, 40.0),
    ("极致", "claude-opus-5", "claude", 5.0, 25.0),
]
# Text is priced by tier rather than by cost. Cost alone puts three of the four tiers at the
# 1-credit floor, so a user upgrading from 标准 to 卓越 sees the same bill and cannot tell the
# tiers apart. The ladder is one credit per tier for input, double that for output — the
# cheapest useful scale, and still far above cost on every row (see the margins printed below).
TEXT_INPUT_CREDITS = {"标准": 1, "高级": 2, "卓越": 3, "极致": 4}


def per_1k_chars(price_per_million_tokens: float, vendor: str) -> float:
    tokens = 1000 * TOKENS_PER_CHAR
    return round(price_per_million_tokens * TEXT_MULTIPLIER[vendor] * tokens / 1_000_000, 6)


text = [{"model_id": f"text/{name}", "stage": "text", "billing_unit": "chars_1k",
         "match": {"direction": direction},
         "purchase_price_cny": per_1k_chars(price, vendor),
         "credits_override": TEXT_INPUT_CREDITS[tier] * factor, "display_name": tier}
        for tier, name, vendor, price_in, price_out in TEXT
        for direction, price, factor in (("in", price_in, 1), ("out", price_out, 2))]

# --- image -----------------------------------------------------------------
# Supplier cost per image in CNY. The Gemini models bill one price at every size; gpt-image-2
# is tiered, plus a catch-all at the top tier so a request whose size we cannot read is charged
# the most rather than refused.
image = [
    {"model_id": "gemini/gemini-image-lite#image", "stage": "image", "billing_unit": "image",
     "match": {}, "purchase_price_cny": 0.06, "display_name": "标准"},
    {"model_id": "gemini/gemini-image-flash#image", "stage": "image", "billing_unit": "image",
     "match": {}, "purchase_price_cny": 0.08, "display_name": "高级"},
    {"model_id": "gemini/gemini-image-pro#image", "stage": "image", "billing_unit": "image",
     "match": {}, "purchase_price_cny": 0.16, "display_name": "卓越"},
    {"model_id": "gpt-image/gpt-image-2#image", "stage": "image", "billing_unit": "image",
     "match": {"size_tier": "1K"}, "purchase_price_cny": 0.06, "display_name": "GPT Image 2"},
    {"model_id": "gpt-image/gpt-image-2#image", "stage": "image", "billing_unit": "image",
     "match": {"size_tier": "2K"}, "purchase_price_cny": 0.10, "display_name": "GPT Image 2"},
    {"model_id": "gpt-image/gpt-image-2#image", "stage": "image", "billing_unit": "image",
     "match": {"size_tier": "4K"}, "purchase_price_cny": 0.12, "display_name": "GPT Image 2"},
    {"model_id": "gpt-image/gpt-image-2#image", "stage": "image", "billing_unit": "image",
     "match": {}, "purchase_price_cny": 0.12, "display_name": "GPT Image 2 (尺寸未知)"},
]

# --- voice -----------------------------------------------------------------
# 百炼 quotes per 10k characters; divided by ten so voice shares the text unit.
VOICE = [("tts/cosyvoice-v2", 2.0, "标准"), ("tts/cosyvoice-v3-flash", 1.0, "快速"),
         ("tts/cosyvoice-v3-plus", 2.0, "高清"), ("tts/cosyvoice-v3.5-plus", 1.5, "克隆音色"),
         ("tts/qwen3-tts-flash", 0.8, "Qwen TTS")]
voice = [{"model_id": model_id, "stage": "tts", "billing_unit": "chars_1k", "match": {},
          "purchase_price_cny": round(price_per_10k / 10, 6), "display_name": label}
         for model_id, price_per_10k, label in VOICE]


def main() -> int:
    items = video + text + image + voice
    doc = {
        "note": ("2026-09-13 供应商报价。视频=轻舟万向报价表折后价（Seedance 2.0/2.5 字节厂商、MiniMax 自部署）；"
                 "文本=按档位定价（标准/高级/卓越/极致 输入 1/2/3/4 积分每千字，输出为输入的 2 倍），"
                 "进货价仍记 newapi 刊例价×我方倍率（DeepSeek 0.6 / Gemini 0.8 / GPT 0.8 / Claude 1.8，1 额度=¥1）"
                 "按 1 字=1 token 折成每千字，用于核对利润；"
                 "图片=供应商每张成本；配音=百炼官方价折成每千字。"
                 "计费单位：视频每秒、图片每张、文本与配音每千字。"
                 "match 键与 src/billing/metering.normalize_params 一致。由 scripts/build_price_book_seed.py 生成。"),
        "rule": RULE,
        "items": items,
    }
    SEED.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    per_yuan = (1 + RULE["target_markup"]) / RULE["l1_discount"] / RULE["credit_face_value_cny"]
    print(f"{len(items)} items -> {SEED.relative_to(Path.cwd()) if SEED.is_relative_to(Path.cwd()) else SEED}")
    units = {"second": "积分/秒", "image": "积分/张", "chars_1k": "积分/千字"}
    for item in items:
        raw = item["purchase_price_cny"] * per_yuan
        rate = item.get("credits_override") or max(math.ceil(raw - 1e-9), RULE["min_credits"])
        margin = rate * RULE["credit_face_value_cny"] * RULE["l1_discount"] / item["purchase_price_cny"] - 1
        spec = ",".join(f"{k}={v}" for k, v in item["match"].items()) or "-"
        print(f'  {item["stage"]:6} {item["model_id"]:40} {spec:16} ¥{item["purchase_price_cny"]:<10} '
              f'{rate:>4} {units[item["billing_unit"]]:9} (真实 {raw:6.3f}, 利润 {margin:>6.0%})')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
