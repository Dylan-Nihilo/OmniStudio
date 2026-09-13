"""Generate config/pricing/price_book.seed.json from the supplier quotes.

Run it again whenever a quote changes; the numbers below are the only thing to edit.

Sources, agreed 2026-09-13:
  * Video — 轻舟万向国内大模型报价表 0821, sheet 「国模-视频生成0818」, discounted price of the
    channel we actually buy through: Seedance 2.0 字节厂商 (86折), Seedance 2.5 字节厂商 (85折),
    MiniMax Hailuo 2.3 自部署 (62折). Seedance modes all take image references, never a video,
    so every row uses the 「不含视频」 column.
  * Text and image — newapi list price (kaizo.top /api/pricing, model_ratio x $2 per 1M tokens,
    model_price per call). List price rather than our group rate, so any discount we negotiate
    turns into extra margin instead of forcing a reprice.
  * Voice — 百炼 (DashScope) official price per 10k characters.

FX 6.7 CNY/USD, the rate the supplier's own quote sheet converts at.
"""

from __future__ import annotations

import json
from pathlib import Path

SEED = Path(__file__).resolve().parents[1] / "config" / "pricing" / "price_book.seed.json"

FX = 6.7

RULE = {"credit_face_value_cny": 0.10, "l1_discount": 0.50, "target_markup": 1.20,
        "rounding_step": 1, "min_credits": 1}

# Seedance bills per million tokens; a second of video is width x height x 24fps / 1024 tokens.
TOKENS_PER_SECOND = {"480p": 854 * 480 * 24 // 1024, "720p": 1280 * 720 * 24 // 1024,
                     "1080p": 1920 * 1080 * 24 // 1024}


def per_second(cny_per_million_tokens: float, resolution: str) -> float:
    return cny_per_million_tokens * TOKENS_PER_SECOND[resolution] / 1_000_000


def usd(amount: float) -> float:
    return round(amount * FX, 4)


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

# --- text ------------------------------------------------------------------
# Model ids must equal the name the LLM adapter sends upstream, which is the newapi model name.
TEXT = [
    ("标准", "DeepSeek-V4.1-Flash", 1.5, 6.0),
    ("高级", "gemini-3.7-flash", 1.5, 5.625),
    ("卓越", "gpt-5.6-sol", 5.0, 40.0),
    ("极致", "claude-opus-5", 5.0, 25.0),
]
text = [{"model_id": f"text/{name}", "stage": "text", "billing_unit": "token_1m",
         "match": {"direction": direction}, "purchase_price_cny": usd(price), "display_name": tier}
        for tier, name, price_in, price_out in TEXT
        for direction, price in (("in", price_in), ("out", price_out))]

# --- image -----------------------------------------------------------------
# gemini-3.1-pro-preview bills per token; an image is ~1120 output tokens at 1K/2K
# (Gemini 3 Pro Image's published figure), so $18/1M x 1120 = $0.02016 per image.
GEMINI_IMAGE_TOKENS = 1120
image = [
    {"model_id": "gemini/gemini-3.1-pro-preview#image", "stage": "image", "billing_unit": "image",
     "match": {}, "purchase_price_cny": usd(18.0 * GEMINI_IMAGE_TOKENS / 1_000_000), "display_name": "标准"},
    {"model_id": "gpt-image/gpt-image-2#image", "stage": "image", "billing_unit": "image",
     "match": {}, "purchase_price_cny": usd(0.2), "display_name": "高级"},
    {"model_id": "gpt-image/gpt-image-2.5-sunburst#image", "stage": "image", "billing_unit": "image",
     "match": {}, "purchase_price_cny": usd(0.2), "display_name": "卓越"},
]

# --- voice -----------------------------------------------------------------
VOICE = [("tts/cosyvoice-v2", 2.0, "标准"), ("tts/cosyvoice-v3-flash", 1.0, "快速"),
         ("tts/cosyvoice-v3-plus", 2.0, "高清"), ("tts/cosyvoice-v3.5-plus", 1.5, "克隆音色"),
         ("tts/qwen3-tts-flash", 0.8, "Qwen TTS")]
voice = [{"model_id": model_id, "stage": "tts", "billing_unit": "chars_10k", "match": {},
          "purchase_price_cny": price, "display_name": label} for model_id, price, label in VOICE]


def main() -> int:
    items = video + text + image + voice
    doc = {
        "note": ("2026-09-13 供应商报价：视频=轻舟万向报价表折后价（Seedance 2.0/2.5 字节厂商、"
                 "MiniMax 自部署）；文本/图片=newapi 刊例原价（汇率 6.7）；配音=百炼官方价。"
                 "match 键与 src/billing/metering.normalize_params 一致。由 scripts/build_price_book_seed.py 生成。"),
        "rule": RULE,
        "items": items,
    }
    SEED.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    per_yuan = (1 + RULE["target_markup"]) / RULE["l1_discount"] / RULE["credit_face_value_cny"]
    print(f"{len(items)} items -> {SEED.relative_to(Path.cwd()) if SEED.is_relative_to(Path.cwd()) else SEED}")
    import math
    for item in items:
        credits = max(math.ceil(item["purchase_price_cny"] * per_yuan), RULE["min_credits"])
        spec = ",".join(f"{k}={v}" for k, v in item["match"].items()) or "-"
        print(f'  {item["stage"]:6} {item["model_id"]:44} {spec:18} ¥{item["purchase_price_cny"]:<9} {credits:>6} 积分')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
