import { describe, expect, it, vi } from "vitest";

import {
    catalogModesForStage,
    describePriceItem,
    describeSpec,
    TRANSLATED_CAPABILITIES,
    TRANSLATED_SPEC_KEYS,
} from "@/lib/billingCatalog";

describe("describePriceItem", () => {
    it("names generation models the way the model picker does", () => {
        expect(describePriceItem({ model_id: "seedance/seedance-2.0-video#r2v", stage: "video" })).toEqual({
            name: "Seedance 2.0 卓越 R2V", capability: "r2v", selectable: true, planned: false, retired: false, family: "seedance",
        });
        expect(describePriceItem({ model_id: "gpt-image/gpt-image-2#image", stage: "image" }).name)
            .toBe("GPT Image 2");
    });

    it("flags a generation model the catalog does not offer", () => {
        // Priced but unpickable: nobody can select it, so the row is dead weight.
        const described = describePriceItem({ model_id: "gemini/nano-banana-pro#image", stage: "image", display_name: "Gemini Pro" });
        expect(described).toMatchObject({ selectable: false, planned: false, retired: false, capability: "image", name: "Gemini Pro" });
    });

    it("tells apart retired and missing-entirely models", () => {
        // HappyHorse was offered until the price book narrowed to Seedance and MiniMax. Its
        // price row is dead weight, unlike a planned model's, which must survive to launch.
        const gone = describePriceItem({ model_id: "happyhorse/happyhorse-1.1-video#r2v", stage: "video" });
        expect(gone).toMatchObject({ name: "HappyHorse R2V", selectable: false, planned: false, retired: true });
        const absent = describePriceItem({ model_id: "gemini/gemini-3.1-pro-preview#image", stage: "image" });
        expect(absent).toMatchObject({ selectable: false, planned: false, retired: false });
    });

    it("keeps a planned model's price row out of the purge group", async () => {
        // Nothing in the catalog is `planned` right now — Seedance 2.5 was the last one and
        // went live on JojoKey — so this branch has to be driven directly. It still matters:
        // a planned row must not be swept up with the retired ones.
        vi.resetModules();
        vi.doMock("@/lib/modelCatalog", () => ({
            getCanonicalModeEntry: () => ({
                display_name: "Some Future Model", family: "future", status: "planned",
                ui: { selection_group: "i2v", visible_in: [] },
            }),
            getModelLineEntry: () => null,
        }));
        const { describePriceItem: describe } = await import("@/lib/billingCatalog");
        expect(describe({ model_id: "future/future-video#i2v", stage: "video" })).toMatchObject({
            name: "Some Future Model", selectable: false, planned: true, retired: false,
        });
        vi.doUnmock("@/lib/modelCatalog");
        vi.resetModules();
    });

    it("falls back to the model line when only the mode suffix is unknown", () => {
        const described = describePriceItem({ model_id: "seedance/seedance-2.0-video#v2v", stage: "video" });
        expect(described.selectable).toBe(false);
        expect(described.name).toBe("Seedance 2.0 卓越");
    });

    it("treats text and voice models as expected absences, not problems", () => {
        expect(describePriceItem({ model_id: "text/deepseek-v4-flash", stage: "text", display_name: "标准" })).toEqual({
            name: "标准 · deepseek-v4-flash", capability: null, selectable: true, planned: false, retired: false, family: null,
        });
        expect(describePriceItem({ model_id: "tts/cosyvoice-v2", stage: "tts" }).name).toBe("cosyvoice-v2");
    });
});

describe("describeSpec", () => {
    it("keeps values verbatim and drops the redundant 'true'", () => {
        expect(describeSpec({ resolution: "1080p", audio: true })).toEqual([
            { key: "resolution", value: "1080p" },
            { key: "audio", value: "" },
        ]);
        expect(describeSpec({})).toEqual([]);
    });

    it("only claims a translation for keys the messages actually define", () => {
        for (const { key } of describeSpec({ resolution: "720p", mode: "pro", size_tier: "4K", quality: "high" })) {
            expect(TRANSLATED_SPEC_KEYS.has(key)).toBe(true);
        }
        expect(TRANSLATED_SPEC_KEYS.has("shotType")).toBe(false);
        expect(TRANSLATED_CAPABILITIES.has("i2v")).toBe(true);
        expect(TRANSLATED_CAPABILITIES.has("unknown")).toBe(false);
    });
});

describe("catalogModesForStage", () => {
    it("lists only models a user can actually pick", () => {
        const video = catalogModesForStage("video");
        const ids = video.map((mode) => mode.id);
        expect(ids).toContain("seedance/seedance-2.0-video#i2v");
        expect(ids).toContain("seedance/seedance-2.0-video#r2v");
        // retired, hidden and planned modes never reach the picker, so they must not demand a price
        expect(ids).not.toContain("happyhorse/happyhorse-1.1-video#i2v");
        expect(ids).not.toContain("wan/wan2.7-video#t2v");
        // 2.5 is live now, so the one thing left to exclude is the retired families.
        expect(ids).toContain("seedance/seedance-2.5-video#i2v");
        expect(video.every((mode) => ["i2v", "r2v", "t2v", "v2v"].includes(mode.capability))).toBe(true);
    });

    it("separates image models from video models and ignores text/voice", () => {
        expect(catalogModesForStage("image").map((mode) => mode.id)).toContain("gpt-image/gpt-image-2#image");
        expect(catalogModesForStage("image").map((mode) => mode.id)).not.toContain("seedance/seedance-2.0-video#i2v");
        expect(catalogModesForStage("text")).toEqual([]);
        expect(catalogModesForStage("tts")).toEqual([]);
    });

    it("is sorted by the name shown to users", () => {
        const names = catalogModesForStage("video").map((mode) => mode.name);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });
});
