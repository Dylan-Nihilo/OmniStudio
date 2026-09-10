"use client";

import { useEffect, useState, useMemo } from "react";
import { Palette, Layout, Film, BookOpen, Users, Video, Clapperboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProjectStore } from "@/store/projectStore";
import { buildLocalizedPipelineSteps, resolveActivePipelineStep, type PipelineStepId } from "@/lib/pipelineSteps";
import PipelineSidebar from "@/components/layout/PipelineSidebar";
import EpisodeMiniList from "@/components/layout/EpisodeMiniList";
import type { BreadcrumbSegment } from "@/components/layout/BreadcrumbBar";
import ScriptProcessor from "@/components/modules/ScriptProcessor";
import Cast from "@/components/modules/Cast";
import VideoGenerator from "@/components/modules/VideoGenerator";
import VideoAssembly from "@/components/modules/VideoAssembly";
import ConsistencyVault from "@/components/modules/ConsistencyVault";
import ArtDirection from "@/components/modules/ArtDirection";
import StoryboardComposer from "@/components/modules/StoryboardComposer";
import ModelSettingsModal from "@/components/common/ModelSettingsModal";
import EnvConfigDialog from "@/components/project/EnvConfigDialog";
import PromptConfigModal from "@/components/project/PromptConfigModal";
import StoryboardR2V from "@/components/modules/StoryboardR2V";
import EntityConfirmModal from "@/components/modules/EntityConfirmModal";
import EpisodeEditLeaseGuard from "@/components/collaboration/EpisodeEditLeaseGuard";
import { ActionMenu, Button, EmptyState, LoadingState } from "@omnistudio/ui";
import AppShell from "@/components/layout/AppShell";
import styles from "./ProjectClient.module.css";



const STEP_ICONS: Record<PipelineStepId, typeof BookOpen> = {
    script: BookOpen,
    art_direction: Palette,
    assets: Users,
    cast: Users,
    storyboard: Layout,
    storyboard_r2v: Clapperboard,
    motion: Video,
    assembly: Film,
};

export default function ProjectClient({ id, breadcrumbSegments }: { id: string; breadcrumbSegments?: BreadcrumbSegment[] }) {
    const [activeStep, setActiveStep] = useState(() => window.location.hash.split("#")[2] || "script");
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [reload, setReload] = useState(0);
    const tChrome = useTranslations("pipelineChrome");
    const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
    const [envDialogOpen, setEnvDialogOpen] = useState(false);
    const [promptConfigOpen, setPromptConfigOpen] = useState(false);
    const t = useTranslations("project");
    const tp = useTranslations("pipeline");

    const selectProject = useProjectStore((state) => state.selectProject);
    const currentProject = useProjectStore((state) => state.currentProject);

    // R2V v2 Phase 6 — content_mode lives on the parent series; fetch on
    // mount when project has series_id, default to "scripted" otherwise.
    const [seriesContentMode, setSeriesContentMode] = useState<"scripted" | "freeform">("scripted");
    useEffect(() => {
        const sid = currentProject?.series_id;
        if (!sid) {
            setSeriesContentMode("scripted");
            return;
        }
        let cancelled = false;
        import("@/lib/api").then(({ api }) => api.getSeries(sid))
            .then((s: any) => { if (!cancelled) setSeriesContentMode(s?.content_mode === "freeform" ? "freeform" : "scripted"); })
            .catch(() => { if (!cancelled) setSeriesContentMode("scripted"); });
        return () => { cancelled = true; };
    }, [currentProject?.series_id]);

    const steps = useMemo(() => {
        // PR-3f routing: backend enum "r2v" → unified workbench (5 steps).
        // Anything else (i2v_legacy, missing) → legacy six-step path. Old
        // projects without workflow_mode default to legacy for backward
        // compat (spec §3.2).
        const base = buildLocalizedPipelineSteps(
            currentProject?.workflow_mode,
            seriesContentMode,
            (key) => tp(key),
        ).map((step) => ({ ...step, icon: STEP_ICONS[step.id] }));

        // Per-step stage status (conservative signals from project state —
        // NOT wizard done-checks; see storyboard-r2v-unified mock). Script
        // has no field on the episode, so it stays status-less (honest —
        // don't fabricate a "done" we can't verify). Assembly is soft-gated
        // (lock + label) when there are no shots yet, but stays CLICKABLE
        // (no navigation behavior change).
        const frames = currentProject?.frames ?? [];
        const chars = currentProject?.characters ?? [];
        const bound = chars.filter(c => c.voice_id).length;
        const frameCount = frames.length;
        const hasArt = !!currentProject?.art_direction;
        const hasMerged = !!currentProject?.merged_video_url;
        const statusFor = (id: string): { status?: "ready" | "idle" | "gated"; statusLabel?: string } => {
            switch (id) {
                case "art_direction":
                    return hasArt ? { status: "ready", statusLabel: tp("railArtReady") } : { status: "idle" };
                case "cast":
                    return chars.length > 0
                        ? (bound > 0
                            ? { status: "ready", statusLabel: tp("railCastBound", { n: chars.length, m: bound }) }
                            : { status: "ready", statusLabel: tp("railCast", { n: chars.length }) })
                        : { status: "idle" };
                case "storyboard_r2v":
                case "storyboard":
                    return frameCount > 0 ? { status: "ready", statusLabel: tp("railShots", { n: frameCount }) } : { status: "idle" };
                case "assembly":
                    return hasMerged
                        ? { status: "ready", statusLabel: tp("railAssembled") }
                        : (frameCount > 0 ? { status: "ready", statusLabel: tp("railAssemblyReady") } : { status: "gated", statusLabel: tp("railAssemblyGated") });
                default:
                    return {};
            }
        };
        return base.map(s => ({ ...s, ...statusFor(s.id) }));
    }, [currentProject, seriesContentMode, tp]);

    useEffect(() => { setActiveStep(window.location.hash.split("#")[2] || "script"); }, [id]);

    useEffect(() => {
        if (loading || currentProject?.id !== id) return;
        const resolved = resolveActivePipelineStep(activeStep, steps);
        if (resolved !== activeStep) setActiveStep(resolved);
    }, [activeStep, steps, loading, currentProject?.id, id]);

    const handleBackToHome = () => {
        window.location.hash = '';
    };

    // Cross-module step navigation event (used by intra-module
    // affordances like Storyboard's "画风" pill that wants to jump
    // to Art Direction without prop-drilling setActiveStep into
    // every leaf component).
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<string>).detail;
            if (typeof detail !== "string") return;
            if (steps.some((s) => s.id === detail)) {
                setActiveStep(detail);
            }
        };
        document.addEventListener("omni_studio:navigateStep", handler);
        return () => document.removeEventListener("omni_studio:navigateStep", handler);
    }, [steps]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadFailed(false);
        selectProject(id).then(success => { if (!cancelled) { setLoadFailed(!success); setLoading(false); } });
        return () => { cancelled = true; };
    }, [id, selectProject, reload]);

    if (loading) return <div className={styles.root}><LoadingState label={tChrome("loading")} /></div>;

    if (!currentProject || currentProject.id !== id) {
        return <div className={styles.root}><EmptyState title={tChrome("loadFailed")} action={<><Button onPress={() => setReload(value => value + 1)}>{tChrome("retry")}</Button><Button variant="quiet" onPress={handleBackToHome}>{t("backToList")}</Button></>} /></div>;
    }

    const segments = breadcrumbSegments || [{ label: "Omni Studio", hash: "#/" }, { label: currentProject.title }];

    const settingsActions = <ActionMenu label={tChrome("settings")} items={[
        { id: "env", label: t("apiKeyConfig"), onAction: () => setEnvDialogOpen(true) },
        { id: "prompt", label: tChrome("promptSettings"), onAction: () => setPromptConfigOpen(true) },
        { id: "model", label: tChrome("modelSettings"), onAction: () => setModelSettingsOpen(true) },
    ]} />;
    const context = <PipelineSidebar activeStep={activeStep} onStepChange={setActiveStep} steps={steps}
        projectLabel={currentProject.title} projectSubLabel={currentProject.episode_number ? `EP.${String(currentProject.episode_number).padStart(2, "0")}` : undefined}
        breadcrumbSegments={segments} headerActions={settingsActions}
        topSlot={currentProject.series_id ? <EpisodeMiniList seriesId={currentProject.series_id} currentProjectId={id} activeStep={activeStep} /> : undefined} />;

    return (
        <main className={styles.root}>
            {/* Model Settings Modal */}
            <ModelSettingsModal
                isOpen={modelSettingsOpen}
                onClose={() => setModelSettingsOpen(false)}
            />

            {/* Prompt Config Modal */}
            <PromptConfigModal
                isOpen={promptConfigOpen}
                onClose={() => setPromptConfigOpen(false)}
            />

            {/* Environment Config Dialog */}
            <EnvConfigDialog
                isOpen={envDialogOpen}
                onClose={() => setEnvDialogOpen(false)}
                isRequired={false}
            />

            <AppShell activeTab="editor" onTabChange={() => {}} context={context} transitionKey={`${id}/${activeStep}`}>
                <EpisodeEditLeaseGuard scriptId={id}>
                    <div className={styles.content}>
                        {loadFailed && <div role="alert" className={styles.error}>{tChrome("refreshFailed")}<Button variant="quiet" onPress={() => setReload(value => value + 1)}>{tChrome("retry")}</Button></div>}
                        {activeStep === "script" && <ScriptProcessor />}
                        {activeStep === "art_direction" && <ArtDirection />}
                        {activeStep === "cast" && <Cast />}
                        {activeStep === "assets" && <ConsistencyVault />}
                        {activeStep === "storyboard" && <StoryboardComposer />}
                        {activeStep === "storyboard_r2v" && <StoryboardR2V />}
                        {activeStep === "motion" && <VideoGenerator />}
                        {activeStep === "assembly" && <VideoAssembly />}
                    </div>
                </EpisodeEditLeaseGuard>
            </AppShell>

            <EntityExtractionConfirm />
        </main>
    );
}

function EntityExtractionConfirm() {
    const ts = useTranslations("script");
    const pendingExtraction = useProjectStore((s) => s.pendingExtraction);
    const isAnalyzing = useProjectStore((s) => s.isAnalyzing);
    const currentProject = useProjectStore((s) => s.currentProject);
    const confirmExtraction = useProjectStore((s) => s.confirmExtraction);
    const discardExtraction = useProjectStore((s) => s.discardExtraction);

    const handleConfirm = async (selection: Parameters<React.ComponentProps<typeof EntityConfirmModal>["onConfirm"]>[0]) => {
        try {
            await confirmExtraction(selection);
            const refreshed = useProjectStore.getState().currentProject;
            if (refreshed?.series_id) {
                document.dispatchEvent(new CustomEvent("omni_studio:openReconcile"));
            }
        } catch {
            const { toast } = await import("@/store/toastStore");
            toast.error(ts("analysisFailedShort"));
        }
    };

    const handleDiscard = () => {
        discardExtraction();
        import("@/store/toastStore").then(({ toast }) => toast.info(ts("extractionDiscarded")));
    };

    return (
        <EntityConfirmModal
            isOpen={!!pendingExtraction}
            isPending={isAnalyzing}
            preview={pendingExtraction}
            currentCounts={{
                characters: currentProject?.characters?.length ?? 0,
                scenes: currentProject?.scenes?.length ?? 0,
                props: currentProject?.props?.length ?? 0,
            }}
            onConfirm={handleConfirm}
            onDiscard={handleDiscard}
        />
    );
}
