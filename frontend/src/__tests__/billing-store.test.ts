import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PricingTable } from "@/lib/billing";
import { creditsFor, useBillingStore } from "@/store/billingStore";

vi.mock("@/lib/billing", async () => {
    const actual = await vi.importActual<typeof import("@/lib/billing")>("@/lib/billing");
    return { ...actual, billingApi: { wallet: vi.fn(), ledger: vi.fn(), quote: vi.fn(), pricingTable: vi.fn() } };
});

const { billingApi } = await import("@/lib/billing");

const PRICING: PricingTable = {
    version: 3,
    credit_face_value_cny: 0.1,
    items: [
        { item_id: "a", model_id: "wan/wan2.7-video#i2v", stage: "video", unit: "second",
          match: { resolution: "720p" }, credits: 27, display_name: "" },
        { item_id: "b", model_id: "wan/wan2.7-video#i2v", stage: "video", unit: "second",
          match: { resolution: "720p", audio: true }, credits: 40, display_name: "" },
        { item_id: "c", model_id: "wan/wan2.7-image#image", stage: "image", unit: "image",
          match: {}, credits: 9, display_name: "" },
    ],
};

beforeEach(() => {
    useBillingStore.setState({ enabled: null, wallet: null, pricing: null, loading: false });
    vi.clearAllMocks();
});

describe("creditsFor", () => {
    it("prefers the most specific matching spec", () => {
        expect(creditsFor(PRICING, "wan/wan2.7-video#i2v", { resolution: "720p" })).toBe(27);
        expect(creditsFor(PRICING, "wan/wan2.7-video#i2v", { resolution: "720p", audio: true })).toBe(40);
    });

    it("matches items with no spec constraints", () => {
        expect(creditsFor(PRICING, "wan/wan2.7-image#image", { size_tier: "2K" })).toBe(9);
    });

    it("returns null for unpriced models, specs and a missing table", () => {
        expect(creditsFor(PRICING, "unknown/model", {})).toBeNull();
        expect(creditsFor(PRICING, "wan/wan2.7-video#i2v", { resolution: "480p" })).toBeNull();
        expect(creditsFor(null, "wan/wan2.7-video#i2v", { resolution: "720p" })).toBeNull();
    });
});

describe("billing store", () => {
    it("turns billing on once the wallet responds", async () => {
        vi.mocked(billingApi.wallet).mockResolvedValue({
            wallet_id: "w1", workspace_id: "ws1", balance: 1000, frozen: 200, available: 800, role: "root",
        });
        await useBillingStore.getState().refresh();
        expect(useBillingStore.getState().enabled).toBe(true);
        expect(useBillingStore.getState().role()).toBe("root");
        expect(useBillingStore.getState().isLow()).toBe(false);
    });

    it("stays off for deployments without billing", async () => {
        vi.mocked(billingApi.wallet).mockRejectedValue({ response: { status: 404 } });
        await useBillingStore.getState().refresh();
        expect(useBillingStore.getState().enabled).toBe(false);
        expect(useBillingStore.getState().wallet).toBeNull();
    });

    it("keeps the previous verdict while the user is signed out", async () => {
        useBillingStore.setState({ enabled: true });
        vi.mocked(billingApi.wallet).mockRejectedValue({ response: { status: 401 } });
        await useBillingStore.getState().refresh();
        expect(useBillingStore.getState().enabled).toBe(true);
    });

    it("flags a low balance against the threshold", async () => {
        vi.mocked(billingApi.wallet).mockResolvedValue({
            wallet_id: "w1", workspace_id: "ws1", balance: 300, frozen: 0, available: 300, role: null,
        });
        await useBillingStore.getState().refresh();
        expect(useBillingStore.getState().isLow()).toBe(true);
    });
});
