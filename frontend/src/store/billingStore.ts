import { useEffect } from "react";
import { create } from "zustand";

import { billingApi, type PlatformRole, type PricingTable, type WalletSummary } from "@/lib/billing";
import { getCanonicalModeId } from "@/lib/modelCatalog";

/**
 * Wallet state shared by the sidebar badge, the generate buttons and the admin console.
 *
 * `enabled` starts unknown and is decided by the first `/billing/wallet` call: deployments
 * without billing (desktop, self-hosted) get a 404/503 and the whole UI stays hidden, so a
 * missing billing backend never blocks creation.
 */
interface BillingState {
    enabled: boolean | null;
    /**
     * Whether rates exist to show, which is not the same as whether we charge. Costs go up
     * in the UI on this flag so the operator can check every price in situ and users get
     * used to seeing them, while `enabled` still governs the deduction.
     */
    ratesPublished: boolean;
    wallet: WalletSummary | null;
    pricing: PricingTable | null;
    loading: boolean;
    lowBalanceThreshold: number;
    refresh: () => Promise<void>;
    loadPricing: () => Promise<void>;
    role: () => PlatformRole;
    isLow: () => boolean;
}

/** In-flight price-book fetch, shared so concurrent callers wait on one request. */
let pricingRequest: Promise<void> | null = null;

export const useBillingStore = create<BillingState>((set, get) => ({
    enabled: null,
    ratesPublished: false,
    wallet: null,
    pricing: null,
    loading: false,
    lowBalanceThreshold: 500,

    refresh: async () => {
        if (get().loading) return;
        set({ loading: true });
        try {
            const wallet = await billingApi.wallet();
            // A proxy that does not forward /billing returns the SPA's index.html with a 200,
            // so check the shape before trusting it.
            if (typeof wallet !== "object" || wallet === null || typeof wallet.enabled !== "boolean") {
                set({ wallet: null, enabled: false, ratesPublished: false, loading: false });
                return;
            }
            // Root/admin get a wallet even while billing is off so they can set prices up first;
            // the badge only appears once the deployment actually bills.
            set({ wallet, enabled: wallet.enabled,
                  ratesPublished: wallet.rates_published ?? false, loading: false });
        } catch (error) {
            const status = (error as { response?: { status?: number } })?.response?.status;
            // 401 just means "not signed in yet"; keep the previous verdict and retry later.
            set({ loading: false, enabled: status === 401 ? get().enabled : false });
        }
    },

    loadPricing: async () => {
        // Every picker on a screen asks for the table at once now that the hook fetches it.
        // One request answers all of them; without this a storyboard full of shot panels
        // would open with a dozen identical calls in flight.
        if (pricingRequest) return pricingRequest;
        pricingRequest = (async () => {
            try {
                set({ pricing: await billingApi.pricingTable() });
            } catch {
                set({ pricing: null });
            } finally {
                pricingRequest = null;
            }
        })();
        return pricingRequest;
    },

    role: () => get().wallet?.role ?? null,

    isLow: () => {
        const { wallet, lowBalanceThreshold } = get();
        return wallet?.available !== undefined && wallet.available < lowBalanceThreshold;
    },
}));

/**
 * Credits per unit for a model + spec, or null when the item has no price.
 *
 * Every published rate is a whole number of credits, which is what the server charges, so
 * the caller multiplies it by the quantity and rounds up — same arithmetic a user would do.
 */
export function creditsFor(pricing: PricingTable | null, modelId: string, params: Record<string, unknown> = {}): number | null {
    if (!pricing) return null;
    const pricingModelId = getCanonicalModeId(modelId) ?? modelId;
    const candidates = pricing.items.filter((item) => item.model_id === pricingModelId
        && Object.entries(item.match).every(([key, value]) => params[key] === value));
    if (!candidates.length) return null;
    // Most specific match wins, mirroring PriceBookSnapshot.find on the server.
    const best = candidates.reduce((a, b) => (Object.keys(b.match).length > Object.keys(a.match).length ? b : a));
    return best.credits;
}


/**
 * Credit cost of a model, for the moment somebody chooses it.
 *
 * A model's rate varies by resolution, and resolution is picked after the model, so a single
 * number would be a guess. This reports the spread instead: one figure when the model bills
 * the same at every size, a range when it does not. That is also what explains the tiers —
 * why 标准 stops at 720p and why 2.5 costs what it does.
 *
 * Takes the canonical price-book id (`seedance/seedance-2.0-video#i2v`); pickers hold legacy
 * flat ids, so resolve through getCanonicalModeId first.
 */
export function creditRange(pricing: PricingTable | null, modelId: string): { min: number; max: number; unit: string } | null {
    if (!pricing) return null;
    const pricingModelId = getCanonicalModeId(modelId) ?? modelId;
    const rates = pricing.items.filter((item) => item.model_id === pricingModelId);
    if (!rates.length) return null;
    const credits = rates.map((item) => item.credits);
    return { min: Math.min(...credits), max: Math.max(...credits), unit: rates[0].unit };
}

/**
 * The published price book, fetched on first use.
 *
 * This used to only subscribe, and the fetch lived inside CreditCost. Every picker that
 * labels its options with a rate reads the table too, so on any screen without a cost badge
 * mounted the table stayed null and all those labels silently rendered as nothing — which
 * is exactly how the script-model dropdown came to show no credits at all. Loading is the
 * hook's job so a caller cannot forget it.
 *
 * Returns null while rates are not meant to be shown, so a deployment that neither charges
 * nor publishes renders no costs rather than a zero.
 */
export function usePricingTable(): PricingTable | null {
    const enabled = useBillingStore((state) => state.enabled);
    const ratesPublished = useBillingStore((state) => state.ratesPublished);
    const pricing = useBillingStore((state) => state.pricing);
    const loadPricing = useBillingStore((state) => state.loadPricing);
    const visible = Boolean(enabled) || ratesPublished;

    useEffect(() => {
        if (visible && !pricing) void loadPricing();
    }, [visible, pricing, loadPricing]);

    return visible ? pricing : null;
}
