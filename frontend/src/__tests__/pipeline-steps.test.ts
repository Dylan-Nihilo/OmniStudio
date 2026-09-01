import { describe, expect, it } from "vitest";
import { getMessages } from "@/lib/i18n";
import {
    buildLocalizedPipelineSteps,
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
            "1. 脚本",
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
            "1. Script",
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
