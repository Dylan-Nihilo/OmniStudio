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
