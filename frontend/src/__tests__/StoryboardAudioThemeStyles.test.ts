import { describe, expect, it } from "vitest";
import {
    getDialogueAudioRowClasses,
    getDialogueInputClasses,
    getDialogueInsetControlClasses,
    getDialogueWorkbenchSurfaceClasses,
} from "@/components/modules/storyboard-r2v/DialogueAudioRow";
import { getPromptExpandTextareaClasses } from "@/components/modules/storyboard-r2v/PromptExpandModal";

describe("Storyboard prompt and audio theme surfaces", () => {
    it("uses the theme input surface for the expanded prompt editor", () => {
        const classes = getPromptExpandTextareaClasses();

        expect(classes).toContain("bg-input-bg");
        expect(classes).toContain("text-foreground");
        expect(classes).not.toContain("bg-black/");
    });

    it("keeps the dialogue row and workbench opaque and readable in light themes", () => {
        const row = getDialogueAudioRowClasses();
        const workbench = getDialogueWorkbenchSurfaceClasses();

        expect(row).toContain("bg-surface-inset");
        expect(workbench).toContain("bg-surface");
        expect(workbench).not.toContain("bg-surface/");
        expect(`${row} ${workbench}`).not.toContain("bg-black/");
    });

    it("uses semantic input and inset surfaces for audio controls", () => {
        const input = getDialogueInputClasses();
        const insetControl = getDialogueInsetControlClasses();

        expect(input).toContain("bg-input-bg");
        expect(input).toContain("text-foreground");
        expect(insetControl).toContain("bg-surface-inset");
        expect(`${input} ${insetControl}`).not.toContain("bg-black/");
    });
});
