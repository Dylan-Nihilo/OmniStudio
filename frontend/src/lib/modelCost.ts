import { getCanonicalModeId } from "@/lib/modelCatalog";
import { creditRange } from "@/store/billingStore";
import type { PricingTable } from "@/lib/billing";

/**
 * What a model costs, phrased for the moment somebody picks it.
 *
 * Users on a hosted plan should not be reading provider names or model ids — they pick a
 * tier and spend credits. Showing the rate at the point of choice is what makes that a real
 * choice rather than a guess, and it is what explains the tiers: why 标准 exists, why 2.5
 * costs several times as much.
 *
 * Returns null when there is no published price book, so a deployment that does not bill
 * shows nothing rather than a zero.
 */
export function creditLabel(
    pricing: PricingTable | null,
    modelId: string,
    unitLabels: Record<string, string>,
): string | null {
    // Pickers hold legacy flat ids; the price book is keyed by canonical mode id.
    const canonical = getCanonicalModeId(modelId) ?? modelId;
    const range = creditRange(pricing, canonical);
    if (!range) return null;
    const unit = unitLabels[range.unit] ?? range.unit;
    // One figure when the model bills the same at every size, a range when it does not —
    // resolution is chosen after the model, so a single number would be a guess.
    const amount = range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
    return `${amount} ${unit}`;
}

/**
 * Pixel tier an image price matches on. Mirrors `size_tier` in src/billing/metering.py —
 * longest side 1024 or less is 1K, 2048 or less is 2K, anything larger is 4K.
 *
 * Worth keeping in step: image rows are keyed by tier, and a quote sent without one falls
 * through to the catch-all row, which is deliberately the dearest. Showing that figure
 * would overstate every image on screen.
 */
export function sizeTier(size: string | null | undefined): string | undefined {
    if (!size) return undefined;
    const named = size.trim().toUpperCase();
    if (named === "1K" || named === "2K" || named === "4K") return named;
    const match = /(\d+)\s*[x*×]\s*(\d+)/i.exec(size);
    if (!match) return undefined;
    const longest = Math.max(Number(match[1]), Number(match[2]));
    if (longest <= 1024) return "1K";
    if (longest <= 2048) return "2K";
    return "4K";
}

/**
 * Pixel size the asset pipeline uses for each aspect ratio. Mirrors ASPECT_RATIO_TO_SIZE in
 * src/apps/comic_gen/assets.py — the reference-image UI picks a ratio, not a size, and the
 * price is keyed by size. Every entry is 1K today; the map exists so that stays true by
 * checking rather than by assumption.
 */
export const ASSET_SIZE_BY_RATIO: Record<string, string> = {
    "9:16": "576*1024",
    "3:4": "768*1024",
    "1:1": "1024*1024",
    "4:3": "1024*768",
    "16:9": "1024*576",
};

/** Price-book params for one image request, in the shape the server matches on. */
export function imageCostParams(size: string | null | undefined,
                                quality?: string | null): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    const tier = sizeTier(size);
    if (tier) params.size_tier = tier;
    if (quality) params.quality = quality;
    return params;
}

/**
 * Credits a text action will cost, give or take.
 *
 * Text bills per thousand characters in each direction, and the reply's length is not known
 * until it arrives — so this is an estimate and has to be labelled as one. The input half is
 * exact (the characters are on screen); the output half assumes it runs to a fraction of the
 * input, which is what script analysis and polishing actually do.
 */
export const TEXT_OUTPUT_RATIO = 0.35;

export function estimateTextCredits(
    pricing: PricingTable | null,
    apiModelId: string | null | undefined,
    inputChars: number,
): number | null {
    if (!pricing || !apiModelId || inputChars <= 0) return null;
    const rate = (direction: string) =>
        pricing.items.find((item) => item.model_id === `text/${apiModelId}`
            && item.match.direction === direction)?.credits ?? null;
    const inRate = rate("in");
    const outRate = rate("out");
    if (inRate === null || outRate === null) return null;
    const thousands = inputChars / 1000;
    return Math.max(1, Math.ceil(thousands * inRate + thousands * TEXT_OUTPUT_RATIO * outRate - 1e-9));
}

/** Unit names for a rate label, shared so every picker words a cost the same way. */
export function unitLabels(t: (key: string) => string): Record<string, string> {
    return { second: t("unitSecond"), image: t("unitImage"), chars_1k: t("unitChars1k") };
}

/** Append the cost to a picker option's description, leaving it alone when we do not bill. */
export function withCreditLabel(
    description: string,
    pricing: PricingTable | null,
    modelId: string,
    unitLabels: Record<string, string>,
): string {
    const label = creditLabel(pricing, modelId, unitLabels);
    return label ? (description ? `${label} · ${description}` : label) : description;
}
