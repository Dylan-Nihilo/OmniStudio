export interface PlanSettings {
    model: string;
    target_duration: number | null;
    pacing: 'balanced' | 'brisk' | 'measured';
    instruction: string;
}
export interface PlannedShot {
    id: string;
    title: string;
    description: string;
    camera: string;
    duration: number;
    source_quote: string;
    dialogue: { speaker: string; line: string; mode: 'on_screen' | 'voiceover' }[];
}
export interface PlannedSegment {
    id: string;
    title: string;
    scene_id: string;
    purpose: string;
    start_state: string;
    end_state: string;
    connection: string;
    reference_names: string[];
    shots: PlannedShot[];
    frame_id?: string | null;
}
/** A blocking issue the server found; `warnings` stay advisory. */
export interface PlanProblem {
    segment_index: number;
    segment_id: string;
    shot_id: string | null;
    field: 'source_quote' | 'dialogue' | 'speaker' | 'duration' | 'reference_names' | 'scene_id' | 'ids';
    message: string;
}

export interface ProductionPlan {
    id: string;
    revision: string;
    created_at: number;
    status: 'draft' | 'approved';
    settings: PlanSettings;
    source_fingerprint: string;
    storyboard_fingerprint: string;
    summary: string;
    continuity_rules: string;
    segments: PlannedSegment[];
    warnings: string[];
    problems: PlanProblem[];
}
export interface ProductionReview {
    frame_id: string;
    segment_id: string;
    fingerprint: string;
    ready: boolean;
    can_confirm: boolean;
    blockers: string[];
    reference_urls: string[];
    preview_urls: string[];
    previous_frame_id?: string | null;
    previous_video_url?: string | null;
    needs_review: boolean;
    changed_after_review?: boolean;
}
export interface PlanningJob { id: string; status: 'processing' | 'completed' | 'failed'; error?: string | null; }
export interface PlanOverview {
    draft: ProductionPlan | null;
    active: ProductionPlan | null;
    job: PlanningJob | null;
    storyboard_fingerprint: string;
    versions: { id: string; title: string; created_at: number; frame_count: number }[];
}
export const segmentDuration = (segment: PlannedSegment) => segment.shots.reduce((total, shot) => total + shot.duration, 0);
export const planDuration = (plan: ProductionPlan) => plan.segments.reduce((total, segment) => total + segmentDuration(segment), 0);

export function splitPlanSegment(plan: ProductionPlan, segmentIndex: number, shotIndex: number): ProductionPlan {
    const segment = plan.segments[segmentIndex];
    if (!segment || shotIndex <= 0 || shotIndex >= segment.shots.length) return plan;
    const second = { ...segment, id: crypto.randomUUID(), frame_id: null, shots: segment.shots.slice(shotIndex),
        start_state: segment.shots[shotIndex].description, connection: segment.shots[shotIndex - 1].description };
    return { ...plan, segments: [...plan.segments.slice(0, segmentIndex),
        { ...segment, shots: segment.shots.slice(0, shotIndex), end_state: segment.shots[shotIndex - 1].description },
        second, ...plan.segments.slice(segmentIndex + 1)] };
}

export function mergePlanSegment(plan: ProductionPlan, index: number): ProductionPlan {
    const first = plan.segments[index], next = plan.segments[index + 1];
    if (!first || !next || first.scene_id !== next.scene_id) return plan;
    return { ...plan, segments: [...plan.segments.slice(0, index), { ...first,
        shots: [...first.shots, ...next.shots], end_state: next.end_state,
        reference_names: [...new Set([...first.reference_names, ...next.reference_names])],
    }, ...plan.segments.slice(index + 2)] };
}
