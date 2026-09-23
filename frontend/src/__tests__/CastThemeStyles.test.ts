import { describe, expect, it } from "vitest";
import {
    getCastEmptyThumbnailClasses,
    getCastGeneratingOverlayClasses,
    getCastKindChipClasses,
    getCastThumbnailClasses,
} from "@/components/modules/Cast";
import {
    getCastPromptTextareaClasses,
    getCastTemplateSwitchWarningClasses,
} from "@/components/modules/cast/CastWorkbenchModal";

describe("Cast light-theme surfaces", () => {
    it("uses semantic surfaces for empty and generating asset cards", () => {
        const thumbnail = getCastThumbnailClasses("aspect-square");
        const empty = getCastEmptyThumbnailClasses();
        const generating = getCastGeneratingOverlayClasses();

        expect(thumbnail).toContain("bg-surface-inset");
        expect(empty).toContain("bg-surface-inset");
        expect(generating).toContain("bg-elevated");
        expect(generating).toContain("border-status-processing-border");
        expect(`${thumbnail} ${empty} ${generating}`).not.toContain("bg-black/");
    });

    it("keeps a disabled generation prompt readable in light themes", () => {
        const prompt = getCastPromptTextareaClasses();

        expect(prompt).toContain("bg-input-bg");
        expect(prompt).toContain("disabled:bg-surface-inset");
        expect(prompt).toContain("disabled:text-text-secondary");
        expect(prompt).toContain("disabled:opacity-100");
        expect(prompt).not.toContain("bg-black/");
    });

    it("keeps the dirty-template warning readable against its amber surface", () => {
        const warning = getCastTemplateSwitchWarningClasses();

        expect(warning.container).toContain("bg-amber-500/15");
        expect(warning.container).toContain("border-amber-400/40");
        expect(warning.message).toContain("text-amber-100");
        expect(warning.confirm).toContain("text-amber-100");
    });

    it("keeps asset kind chips legible over bright and dark artwork", () => {
        const chip = getCastKindChipClasses();

        expect(chip).toContain("bg-black/80");
        expect(chip).toContain("text-white");
        expect(chip).toContain("border-white/40");
        expect(chip).toContain("text-[0.625rem]");
        expect(chip).toContain("font-semibold");
        expect(chip).not.toContain("text-text-muted");
    });
});
