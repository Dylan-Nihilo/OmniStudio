import { describe, expect, it } from "vitest";
import { getMessages } from "@/lib/i18n";
import {
    buildLocalizedPipelineSteps,
    nextStepAfterExtraction,
    type PipelineStepMessageKey,
} from "@/lib/pipelineSteps";

function translator(locale: "zh" | "en") {
    const messages = getMessages(locale).pipeline;
    return (key: PipelineStepMessageKey) => messages[key];
}

describe("localized pipeline steps", () => {
    it("uses Chinese labels for the legacy workflow", () => {
        const steps = buildLocalizedPipelineSteps("i2v_legacy", "scripted", translator("zh"));

        expect(steps.map((step) => step.label)).toEqual([
            "1. 剧本与拆分",
            "2. 风格定调",
            "3. 资产",
            "4. 分镜",
            "5. 动态",
            "6. 合成",
        ]);
    });

    it("uses English labels when the global locale is English", () => {
        const steps = buildLocalizedPipelineSteps("r2v", "scripted", translator("en"));

        expect(steps.map((step) => step.label)).toEqual([
            "1. Script & breakdown",
            "2. Art Direction",
            "3. Cast",
            "4. Storyboard",
            "5. Assembly",
        ]);
    });

    it("removes Script and renumbers a freeform unified workflow", () => {
        const steps = buildLocalizedPipelineSteps("r2v", "freeform", translator("zh"));

        expect(steps.map((step) => step.label)).toEqual([
            "1. 风格定调",
            "2. 本集素材",
            "3. 分镜",
            "4. 合成",
        ]);
    });
});


it("routes an extracted list through style setup before reference generation", () => {
    const project = { workflow_mode: "r2v", series_id: "series-1" };
    const art_direction = { style_config: { id: "anime", name: "Anime" } };
    expect(nextStepAfterExtraction(project)).toBe("art_direction");
    expect(nextStepAfterExtraction({ ...project, art_direction })).toBe("cast");
    expect(nextStepAfterExtraction({ workflow_mode: "i2v_legacy", art_direction })).toBe("assets");
    expect(nextStepAfterExtraction(project, { id: "series-1", art_direction })).toBe("cast");
    expect(nextStepAfterExtraction(project, { id: "unrelated-series", art_direction })).toBe("art_direction");
    expect(nextStepAfterExtraction({ art_direction: { style_config: { positive_prompt: "  " } } })).toBe("art_direction");
    expect(nextStepAfterExtraction({ ...project, art_direction: { style_config: { positive_prompt: "ink illustration" } } })).toBe("cast");
});
