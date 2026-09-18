import type { ShotNode } from "./ShotCard";

/**
 * Real-time compute the final assembled prompt from the user's textarea
 * (visual narrative) + structured fields (camera language metadata).
 *
 * Rules (grill-me 2026-05-28, corrected):
 * - duration → NOT in prompt (唯一的特殊字段，走 API `duration` 参数)
 * - shot_size + camera_angle → appended to prompt tail
 * - camera_movement → appended to prompt tail (自然语言描述，含速度)
 * - transition_hint → appended to prompt tail (可选，多分镜视频内转场)
 *
 * Final = textarea visual narrative + 运镜 + 景别/机位 + 转场
 */
export function buildAssembledPrompt(shot: ShotNode): string {
    let base = (shot.prompt || "").trim();

    // Images travel separately, but inline references must keep their subject names.
    base = base.replace(/\[character\d+:([^\]]+)\]/g, (_tag, name: string, offset: number) =>
        base.slice(0, offset).endsWith(name) ? "" : name).replace(/\s+/g, " ").trim();
    if (shot.promptMode === "complete") return base;

    const suffixes: string[] = [];

    // Camera movement (natural language, speed naturally embedded)
    if (shot.cameraMovementStructured) {
        const desc = shot.cameraMovementStructured.description || shot.cameraMovementStructured.primary;
        if (desc) suffixes.push(desc);
    }

    // Shot size + camera angle (grouped)
    const framingParts: string[] = [];
    if (shot.shotSize) framingParts.push(shot.shotSize);
    if (shot.cameraAngle) framingParts.push(shot.cameraAngle);
    if (framingParts.length > 0) {
        suffixes.push(framingParts.join("，"));
    }

    // Transition hint (optional, for multi-shot internal transitions)
    if (shot.transitionHint) {
        suffixes.push(shot.transitionHint);
    }

    if (suffixes.length === 0) return base;

    const separator = base.endsWith("。") || base.endsWith(".") || base.endsWith("，") || base.endsWith(",")
        ? ""
        : "，";
    return base + separator + suffixes.join("，");
}
