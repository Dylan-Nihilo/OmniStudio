import { describe, expect, it } from "vitest";

import {
    catalogModesForStage,
    describePriceItem,
    describeSpec,
    TRANSLATED_CAPABILITIES,
    TRANSLATED_SPEC_KEYS,
} from "@/lib/billingCatalog";

describe("describePriceItem", () => {
    it("names generation models the way the model picker does", () => {
        expect(describePriceItem({ model_id: "happyhorse/happyhorse-1.1-video#r2v", stage: "video" })).toEqual({
            name: "HappyHorse R2V", capability: "r2v", selectable: true, family: "happyhorse",
        });
        expect(describePriceItem({ model_id: "wan/wan2.7-image-pro#image", stage: "image" }).name)
            .toBe("Wan 2.7 Image Pro");
    });

    it("flags a generation model the catalog does not offer", () => {
        // Priced but unpickable: nobody can select it, so the row is dead weight.
        const described = describePriceItem({ model_id: "gemini/nano-banana-pro#image", stage: "image", display_name: "Gemini Pro" });
        expect(described.selectable).toBe(false);
        expect(described.capability).toBe("image");
        expect(described.name).toBe("Gemini Pro");
    });

    it("falls back to the model line when only the mode suffix is unknown", () => {
        const described = describePriceItem({ model_id: "happyhorse/happyhorse-1.1-video#t2v", stage: "video" });
        expect(described.selectable).toBe(false);
        expect(described.name).toBe("HappyHorse 1.1 Video");
    });

    it("treats text and voice models as expected absences, not problems", () => {
        expect(describePriceItem({ model_id: "text/deepseek-v4-flash", stage: "text", display_name: "标准" })).toEqual({
            name: "标准 · deepseek-v4-flash", capability: null, selectable: true, family: null,
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
        expect(ids).toContain("happyhorse/happyhorse-1.1-video#i2v");
        expect(ids).toContain("happyhorse/happyhorse-1.1-video#r2v");
        // hidden and deprecated modes never reach the picker, so they must not demand a price
        expect(ids).not.toContain("wan/wan2.7-video#t2v");
        expect(video.every((mode) => ["i2v", "r2v", "t2v", "v2v"].includes(mode.capability))).toBe(true);
    });

    it("separates image models from video models and ignores text/voice", () => {
        expect(catalogModesForStage("image").map((mode) => mode.id)).toContain("wan/wan2.7-image-pro#image");
        expect(catalogModesForStage("image").map((mode) => mode.id)).not.toContain("happyhorse/happyhorse-1.1-video#i2v");
        expect(catalogModesForStage("text")).toEqual([]);
        expect(catalogModesForStage("tts")).toEqual([]);
    });

    it("is sorted by the name shown to users", () => {
        const names = catalogModesForStage("video").map((mode) => mode.name);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });
});
