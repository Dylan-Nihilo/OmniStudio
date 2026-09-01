export type PipelineStepId =
    | "script"
    | "art_direction"
    | "assets"
    | "cast"
    | "storyboard"
    | "storyboard_r2v"
    | "motion"
    | "assembly";

export type PipelineStepMessageKey =
    | "stepScript"
    | "stepArtDirection"
    | "stepAssets"
    | "stepCast"
    | "stepStoryboard"
    | "stepMotion"
    | "stepAssembly";

export interface LocalizedPipelineStep {
    id: PipelineStepId;
    label: string;
}

export function resolveActivePipelineStep(
    activeStep: string,
    steps: ReadonlyArray<Pick<LocalizedPipelineStep, "id">>,
): string {
    return steps.some((step) => step.id === activeStep)
        ? activeStep
        : (steps[0]?.id ?? "script");
}

const LEGACY_STEP_DEFINITIONS: ReadonlyArray<{
    id: PipelineStepId;
    messageKey: PipelineStepMessageKey;
}> = [
    { id: "script", messageKey: "stepScript" },
    { id: "art_direction", messageKey: "stepArtDirection" },
    { id: "assets", messageKey: "stepAssets" },
    { id: "storyboard", messageKey: "stepStoryboard" },
    { id: "motion", messageKey: "stepMotion" },
    { id: "assembly", messageKey: "stepAssembly" },
];

const UNIFIED_STEP_DEFINITIONS: ReadonlyArray<{
    id: PipelineStepId;
    messageKey: PipelineStepMessageKey;
}> = [
    { id: "script", messageKey: "stepScript" },
    { id: "art_direction", messageKey: "stepArtDirection" },
    { id: "cast", messageKey: "stepCast" },
    { id: "storyboard_r2v", messageKey: "stepStoryboard" },
    { id: "assembly", messageKey: "stepAssembly" },
];

export function buildLocalizedPipelineSteps(
    workflowMode: string | undefined,
    contentMode: "scripted" | "freeform",
    translate: (key: PipelineStepMessageKey) => string,
): LocalizedPipelineStep[] {
    const definitions = workflowMode === "r2v"
        ? UNIFIED_STEP_DEFINITIONS.filter(
            (step) => contentMode !== "freeform" || step.id !== "script",
        )
        : LEGACY_STEP_DEFINITIONS;

    return definitions.map((step, index) => ({
        id: step.id,
        label: `${index + 1}. ${translate(step.messageKey)}`,
    }));
}
