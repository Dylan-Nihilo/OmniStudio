import { create } from "zustand";

import { billingApi, type PlatformRole, type PricingTable, type WalletSummary } from "@/lib/billing";

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
        try {
            set({ pricing: await billingApi.pricingTable() });
        } catch {
            set({ pricing: null });
        }
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
    const candidates = pricing.items.filter((item) => item.model_id === modelId
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
    const rates = pricing.items.filter((item) => item.model_id === modelId);
    if (!rates.length) return null;
    const credits = rates.map((item) => item.credits);
    return { min: Math.min(...credits), max: Math.max(...credits), unit: rates[0].unit };
}

/** Subscribe to the published price book, so a picker label updates when root republishes. */
export function usePricingTable(): PricingTable | null {
    return useBillingStore((state) => state.pricing);
}
