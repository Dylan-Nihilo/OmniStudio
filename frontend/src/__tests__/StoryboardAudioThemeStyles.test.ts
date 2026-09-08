import { describe, expect, it } from "vitest";
import { getPromptExpandTextareaClasses } from "@/components/modules/storyboard-r2v/PromptExpandModal";

describe("Storyboard prompt and audio theme surfaces", () => {
    it("uses the theme input surface for the expanded prompt editor", () => {
        const classes = getPromptExpandTextareaClasses();

        expect(classes).toContain("bg-input-bg");
        expect(classes).toContain("text-foreground");
        expect(classes).not.toContain("bg-black/");
    });

});
