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
    wallet: null,
    pricing: null,
    loading: false,
    lowBalanceThreshold: 500,

    refresh: async () => {
        if (get().loading) return;
        set({ loading: true });
        try {
            const wallet = await billingApi.wallet();
            set({ wallet, enabled: true, loading: false });
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
        return wallet !== null && wallet.available < lowBalanceThreshold;
    },
}));

/** Credits for a model + spec, or null when the item has no price (or billing is off). */
export function creditsFor(pricing: PricingTable | null, modelId: string, params: Record<string, unknown> = {}): number | null {
    if (!pricing) return null;
    const candidates = pricing.items.filter((item) => item.model_id === modelId
        && Object.entries(item.match).every(([key, value]) => params[key] === value));
    if (!candidates.length) return null;
    // Most specific match wins, mirroring PriceBookSnapshot.find on the server.
    const best = candidates.reduce((a, b) => (Object.keys(b.match).length > Object.keys(a.match).length ? b : a));
    return best.credits;
}
