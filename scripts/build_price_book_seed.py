"""Generate config/pricing/price_book.seed.json from the supplier quotes.

Run it again whenever a quote changes; the numbers below are the only thing to edit.

Sources:
  * Video — JojoKey, our own account, 2026-09-14. Seedance comes off the CN line's CNY token
    pricing (POST /v1/video-cn/price-estimate), verified against a real settled task; MiniMax
    off POST /v1/videos/estimate in USD. Replaces the 轻舟万向 quote sheet we costed against
    before we had a real supplier: that sheet had Seedance 2.5 at ¥0.57/¥1.29 per second, a
    fraction of the real cost, so the old 26/57 credit rates sold below the 120% floor.
  * Text — newapi list price (kaizo.top /api/pricing, model_ratio x $2 per 1M tokens) times our
    per-vendor multiplier. newapi settles its quota unit 1:1 against CNY, so a list price of
    "$5" times a 1.8 multiplier costs ¥9 per million tokens.
  * Image — our supplier's per-image cost, flat for the Gemini models and tiered by resolution
    for gpt-image-2.
  * Voice — 百炼 (DashScope) official price per 10k characters.

Nothing here needs an exchange rate except MiniMax: newapi bills 1 unit = ¥1 for text and
image, and Seedance settles in CNY on JojoKey's CN line. MiniMax is not sold on that line, so
it alone goes through the pinned USD_CNY constant below.

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

# --- video -----------------------------------------------------------------
# Seedance settles in CNY on JojoKey's CN line, so it needs no exchange rate at all. The line
# bills output tokens, not seconds: cost = tokens_per_second x duration x the per-million rate
# our account is charged (POST /v1/video-cn/price-estimate reports both the list rate and
# ours; we are on a 0.85 customer ratio).
#
# Do not cost off the `estimated_hold_cny` that endpoint also returns — that is a
# pre-authorisation with a large worst-case buffer, and it reads the same for 480p and 720p.
# A verified 4-second 480p mini task held ¥1.9550 and settled at ¥0.7936.
#
# The rates below are the `no_media` ones, and every mode uses them even though i2v and r2v
# settle on a cheaper `with_media` rate (measured: ¥11.90 per million against mini's ¥19.55,
# so ¥0.1208 a second at 480p rather than ¥0.1984). That is deliberate. Registering a
# reference asset on the CN line costs ¥0.10 each, and a price book keyed on seconds has
# nowhere to put a per-image fee; pricing every mode at the dearer rate covers it. At the
# real with_media rate a 4-second i2v shot with one new reference would settle at ¥0.58 all
# in and clear only 106% — under the floor — whereas the no_media rate leaves it at 209%.
SEEDANCE_CNY_PER_M_TOKENS = {
    "seedance/seedance-2.0-mini": 19.55,
    "seedance/seedance-2.0-fast": 31.45,
    "seedance/seedance-2.0-video": 39.10,
    "seedance/seedance-2.5-video": 70.00,
}
# JojoKey's published output tokens per second of video, times a 1% safety margin: the
# verified task above billed 40594 tokens for 4 seconds of 480p, 0.2% above the 10128 figure,
# because real output runs slightly over the nominal frame size (864x496, not 854x480).
# Overstating tokens can only overstate cost, which can only understate profit.
TOKENS_PER_SECOND = {"480p": 10128, "720p": 21780, "1080p": 49005}
TOKEN_SAFETY_MARGIN = 1.01

# Which resolutions each tier actually sells, from GET /v1/video-cn/models. Only 卓越 reaches
# 1080p; the cheaper two stop at 720p. (Pro also offers 4k upstream, which we neither expose
# nor price.) The tiers use the mainline models rather than the cheaper "特价" ones, which
# accept a reference_image role only: our i2v means "animate this storyboard frame", so 特价
# would quietly stop honouring the frame the shot was drawn for.
SEEDANCE_20_TIERS = [
    ("标准", "seedance/seedance-2.0-mini", ["480p", "720p"]),
    ("高级", "seedance/seedance-2.0-fast", ["480p", "720p"]),
    ("卓越", "seedance/seedance-2.0-video", ["480p", "720p", "1080p"]),
]
SEEDANCE_25_RESOLUTIONS = ["480p", "720p", "1080p"]

# MiniMax is the one family not on the CN line, so it is the one that still needs a
# conversion. A bookkeeping constant, not a live exchange rate: nothing re-reads a market
# feed, and a rate that moved under us would silently restate the margin. It sits above spot
# on purpose. Prices are USD per second from POST /v1/videos/estimate, keyed by minimax-A's
# own size names. The H3 workflow looks cheaper but cannot lock a first frame at all, so it
# cannot serve our i2v slot.
USD_CNY = 7.3
MINIMAX = {"720P": 0.025, "960P": 0.040, "2K": 0.055}


def seedance_per_second(model_line: str, resolution: str) -> float:
    tokens = TOKENS_PER_SECOND[resolution] * TOKEN_SAFETY_MARGIN
    return round(tokens * SEEDANCE_CNY_PER_M_TOKENS[model_line] / 1_000_000, 4)


video: list[dict] = []
for mode in ("t2v", "i2v", "r2v"):
    for tier, model_line, resolutions in SEEDANCE_20_TIERS:
        for resolution in resolutions:
            video.append({"model_id": f"{model_line}#{mode}", "stage": "video",
                          "billing_unit": "second", "match": {"resolution": resolution},
                          "purchase_price_cny": seedance_per_second(model_line, resolution),
                          "display_name": f"Seedance 2.0 {tier}"})
    for resolution in SEEDANCE_25_RESOLUTIONS:
        # 2.5 charges less when the input contains video; ours passes images, which the
        # vendor still counts as no-video input, so every row uses the dearer rate.
        video.append({"model_id": f"seedance/seedance-2.5-video#{mode}", "stage": "video",
                      "billing_unit": "second", "match": {"resolution": resolution},
                      "purchase_price_cny": seedance_per_second("seedance/seedance-2.5-video", resolution),
                      "display_name": "Seedance 2.5"})
for resolution, usd in MINIMAX.items():
    video.append({"model_id": "minimax/minimax-h3#i2v", "stage": "video", "billing_unit": "second",
                  "match": {"resolution": resolution},
                  "purchase_price_cny": round(usd * USD_CNY, 4),
                  "display_name": "MiniMax A"})

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
# Supplier cost per image in CNY, three tiers on the open302 relay (verified 2026-09-15:
# all three return a downloadable image). The Gemini tier bills one price at every size —
# it ignores the requested size and returns its own resolution — while the GPT tiers are
# priced by size, plus a catch-all at the top tier so a request whose size we cannot read
# is charged the most rather than refused.
IMAGE_GEMINI_FLAT = 0.08                                   # 标准
IMAGE_GPT2 = {"1K": 0.06, "2K": 0.10, "4K": 0.12}          # 高级
# 卓越 is 3 fen dearer than 高级 at every size.
IMAGE_GPT25_PREMIUM = 0.03

image = [
    {"model_id": "gpt-image/gemini-3.1-flash-image#image", "stage": "image",
     "billing_unit": "image", "match": {}, "purchase_price_cny": IMAGE_GEMINI_FLAT,
     "display_name": "标准"},
]
for tier, model_line, premium in (("高级", "gpt-image/gpt-image-2", 0.0),
                                  ("卓越", "gpt-image/gpt-image-2.5-sunburst", IMAGE_GPT25_PREMIUM)):
    for size_tier, price in IMAGE_GPT2.items():
        image.append({"model_id": f"{model_line}#image", "stage": "image",
                      "billing_unit": "image", "match": {"size_tier": size_tier},
                      "purchase_price_cny": round(price + premium, 4), "display_name": tier})
    # Size we cannot read falls back to the dearest tier rather than being refused.
    image.append({"model_id": f"{model_line}#image", "stage": "image", "billing_unit": "image",
                  "match": {}, "purchase_price_cny": round(max(IMAGE_GPT2.values()) + premium, 4),
                  "display_name": f"{tier}（尺寸未知）"})

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
        "note": ("2026-09-14 供应商报价。视频=JojoKey 我方账号实测价。"
                 "Seedance 走国内线人民币 token 计价（/v1/video-cn/price-estimate，客户比例 0.85），"
                 "已用一条真实结算任务校验，不涉及汇率；"
                 f"MiniMax 不在国内线，按记账常量 {USD_CNY} 折算（非实时汇率，高于即期以免低估成本）；"
                 "文本=按档位定价（标准/高级/卓越/极致 输入 1/2/3/4 积分每千字，输出为输入的 2 倍），"
                 "进货价仍记 newapi 刊例价×我方倍率（DeepSeek 0.6 / Gemini 0.8 / GPT 0.8 / Claude 1.8，1 额度=¥1）"
                 "按 1 字=1 token 折成每千字，用于核对利润；"
                 "图片=open302 每张成本（标准不分尺寸，高级/卓越按尺寸分档，卓越每档 +¥0.03）；配音=百炼官方价折成每千字。"
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
