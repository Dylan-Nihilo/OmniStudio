import { beforeEach, describe, expect, it, vi } from "vitest";
import { creditLabel, withCreditLabel } from "@/lib/modelCost";

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
          match: { resolution: "720p" }, credits: 27, credits_raw: 26.4, display_name: "" },
        { item_id: "b", model_id: "wan/wan2.7-video#i2v", stage: "video", unit: "second",
          match: { resolution: "720p", audio: true }, credits: 40, credits_raw: 39.6, display_name: "" },
        { item_id: "c", model_id: "wan/wan2.7-image#image", stage: "image", unit: "image",
          match: {}, credits: 9, credits_raw: 8.8, display_name: "" },
        // text costs a fraction of a credit per unit, which is the case rounding must not break
        { item_id: "d", model_id: "text/DeepSeek-V4.1-Flash", stage: "text", unit: "chars_1k",
          match: { direction: "out" }, credits: 1, credits_raw: 0.158, display_name: "标准" },
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

    it("resolves legacy image ids before looking up a published price", () => {
        expect(creditsFor(PRICING, "wan2.7-image", { size_tier: "2K" })).toBe(9);
    });

    it("returns the whole rate the server charges, not the underlying cost", () => {
        // text rounds up to 1 credit per 1000 characters, which is what a user is billed
        expect(creditsFor(PRICING, "text/DeepSeek-V4.1-Flash", { direction: "out" })).toBe(1);
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
            enabled: true, wallet_id: "w1", workspace_id: "ws1", balance: 1000, frozen: 200, available: 800, role: "root",
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

    it("hides the UI when the backend reports billing is switched off", async () => {
        vi.mocked(billingApi.wallet).mockResolvedValue({ enabled: false, role: null });
        await useBillingStore.getState().refresh();
        expect(useBillingStore.getState().enabled).toBe(false);
        expect(useBillingStore.getState().isLow()).toBe(false);
    });

    it("still hands root its role while billing is off, so prices can be set up first", async () => {
        vi.mocked(billingApi.wallet).mockResolvedValue({
            enabled: false, wallet_id: "w1", workspace_id: "ws1", balance: 0, frozen: 0, available: 0, role: "root",
        });
        await useBillingStore.getState().refresh();
        expect(useBillingStore.getState().enabled).toBe(false);
        expect(useBillingStore.getState().role()).toBe("root");
    });

    it("treats an HTML body as billing unavailable", async () => {
        // A proxy that does not forward /billing answers 200 with the SPA shell.
        vi.mocked(billingApi.wallet).mockResolvedValue("<!DOCTYPE html><html></html>" as never);
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
            enabled: true, wallet_id: "w1", workspace_id: "ws1", balance: 300, frozen: 0, available: 300, role: null,
        });
        await useBillingStore.getState().refresh();
        expect(useBillingStore.getState().isLow()).toBe(true);
    });
});

describe("creditLabel", () => {
    const UNITS = { second: "积分/秒", image: "积分/张", chars_1k: "积分/千字" };

    it("reports a range when the rate varies by resolution", () => {
        // Resolution is chosen after the model, so a single figure would be a guess.
        expect(creditLabel(PRICING, "wan/wan2.7-video#i2v", UNITS)).toBe("27–40 积分/秒");
    });

    it("reports one figure when the model bills the same at every size", () => {
        expect(creditLabel(PRICING, "text/DeepSeek-V4.1-Flash", UNITS)).toBe("1 积分/千字");
    });

    it("says nothing on a deployment that does not bill", () => {
        // No published price book must show nothing rather than a zero.
        expect(creditLabel(null, "wan/wan2.7-video#i2v", UNITS)).toBeNull();
    });

    it("leaves a description untouched when there is no price to show", () => {
        expect(withCreditLabel("原描述", null, "anything", UNITS)).toBe("原描述");
        expect(withCreditLabel("原描述", PRICING, "text/DeepSeek-V4.1-Flash", UNITS))
            .toBe("1 积分/千字 · 原描述");
    });
});
