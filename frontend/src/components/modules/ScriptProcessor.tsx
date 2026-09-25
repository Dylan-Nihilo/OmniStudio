"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Film, Upload, Save, Image as ImageIcon } from "lucide-react";
import { Button, EmptyState, SelectField, Tabs } from "@omnistudio/ui";
import { api, sourceApi, type SourceChapterAnalysis, type SourceProductionContext } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { getAspectRatioCssValue } from "@/lib/aspectRatio";
import { toast } from "@/store/toastStore";
import PreviousEpisodeSummary from "@/components/modules/PreviousEpisodeSummary";
import ReconcileModal from "@/components/modules/ReconcileModal";
import { getApiErrorCode } from "@/lib/apiClient";
import { getAssetUrl } from "@/lib/utils";
import { episodeAssets } from "@/lib/episodeAssets";
import { useEditLeaseStore } from "@/store/editLeaseStore";
import ScriptWritingEditor from "./script-writing/ScriptWritingEditor";
import ProductionGuide from "@/components/shared/ProductionGuide";
import TextTierSelect from "@/components/common/TextTierSelect";
import { estimateTextCredits } from "@/lib/modelCost";
import { useBillingStore, usePricingTable } from "@/store/billingStore";
import { useAuthStore } from "@/store/authStore";
import styles from "./ScriptProcessor.module.css";

export default function ScriptProcessor() {
    const ts = useTranslations("script");
    const t = useTranslations("scriptPage");
    const currentProject = useProjectStore(state => state.currentProject);
    const updateProject = useProjectStore(state => state.updateProject);
    const isAnalyzing = useProjectStore(state => state.isAnalyzing);
    const leaseStatus = useEditLeaseStore(state => state.status);
    const leaseToken = useEditLeaseStore(state => state.token);
    const revision = useEditLeaseStore(state => state.revision);
    const clientInstanceId = useEditLeaseStore(state => state.clientInstanceId);
    const setRevision = useEditLeaseStore(state => state.setRevision);
    const projectText = currentProject?.originalText ?? (currentProject as any)?.original_text ?? "";
    const [script, setScript] = useState(projectText);
    const [savedText, setSavedText] = useState(projectText);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [reading, setReading] = useState(false);
    const [reconcileOpen, setReconcileOpen] = useState(false);
    const [selectedScene, setSelectedScene] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const workspaceId = useAuthStore(state => state.activeWorkspace?.id) || "local";
    const draftKey = `omni-script-draft:${workspaceId}:${currentProject?.id}`;
    const [recoveredDraft, setRecoveredDraft] = useState<string | null>(null);
    const tw = useTranslations("scriptWriting");
    // The tier and what it will cost, side by side with the button that spends it. The
    // total is an estimate and says so: the input length is known but the reply's is not.
    const pricing = usePricingTable();
    const ratesVisible = useBillingStore((state) => Boolean(state.enabled) || state.ratesPublished);
    const [textModel, setTextModel] = useState<string | null>(null);
    const [sourceContext, setSourceContext] = useState<SourceProductionContext | null>(null);
    const [sourceAnalyses, setSourceAnalyses] = useState<SourceChapterAnalysis[]>([]);
    const estimatedCredits = estimateTextCredits(pricing, textModel, script.length);

    const readOnly = leaseStatus !== "editing";

    useEffect(() => {
        const projectId = currentProject?.id;
        if (!projectId) {
            setSourceContext(null);
            setSourceAnalyses([]);
            return;
        }
        let active = true;
        void sourceApi.getProductionContext(projectId)
            .then(context => { if (active) setSourceContext(context); })
            .catch(() => { if (active) setSourceContext(null); });
        return () => { active = false; };
    }, [currentProject?.id]);

    useEffect(() => {
        const dependencies = sourceContext?.source_dependencies ?? [];
        if (!dependencies.length) {
            setSourceAnalyses([]);
            return;
        }
        let active = true;
        void Promise.all(dependencies.map(async dependency => {
            const sourceId = typeof dependency.source_id === "string" ? dependency.source_id : "";
            const chapterId = typeof dependency.chapter_id === "string" ? dependency.chapter_id : "";
            if (!sourceId || !chapterId) return null;
            try { return await sourceApi.getChapterAnalysis(sourceId, chapterId); } catch { return null; }
        })).then(results => {
            if (active) setSourceAnalyses(results.filter((item): item is SourceChapterAnalysis => item !== null));
        });
        return () => { active = false; };
    }, [sourceContext]);

    useEffect(() => {
        setScript(projectText);
        setSavedText(projectText);
        setSaveError(null);
        setRecoveredDraft(null);
        try {
            const cached = JSON.parse(localStorage.getItem(draftKey) || 'null');
            if (cached && typeof cached.text === 'string') {
                if (cached.text === projectText && typeof cached.baseText === 'string') setSavedText(cached.baseText);
                else if (cached.text !== projectText) setRecoveredDraft(cached.text);
            }
        } catch { /* Saving to the server remains available without browser storage. */ }
    }, [currentProject?.id, workspaceId]);
    useEffect(() => {
        const open = () => setReconcileOpen(true);
        document.addEventListener("omni_studio:openReconcile", open);
        return () => document.removeEventListener("omni_studio:openReconcile", open);
    }, []);

    const changeScript = (text: string) => {
        setScript(text);
        setSaveError(null);
        try { localStorage.setItem(draftKey, JSON.stringify({ text, baseText: savedText })); } catch { /* beforeunload still protects unsaved work. */ }
        if (currentProject) updateProject(currentProject.id, { originalText: text, original_text: text } as any);
    };
    const save = async () => {
        if (!currentProject || script === savedText || savingRef.current || !leaseToken || !revision || readOnly) return;
        const projectId = currentProject.id;
        const text = script;
        savingRef.current = true;
        setSaving(true);
        setSaveError(null);
        try {
            let saved;
            try {
                saved = await api.updateScriptText(projectId, text, revision, leaseToken, clientInstanceId);
            } catch (error) {
                if (getApiErrorCode(error) !== "EDIT_REVISION_CONFLICT") throw error;
                const latest = await api.getProject(projectId);
                // Asset and render updates also advance the project revision.
                // Rebase only while the saved text is unchanged; CAS still protects the retry.
                if (latest.originalText !== savedText || !latest._revision
                    || useProjectStore.getState().currentProject?.id !== projectId) throw error;
                saved = await api.updateScriptText(projectId, text, latest._revision, leaseToken, clientInstanceId);
            }
            if (useProjectStore.getState().currentProject?.id !== projectId || (useAuthStore.getState().activeWorkspace?.id || 'local') !== workspaceId) return;
            setSavedText(text);
            try {
                const cached = JSON.parse(localStorage.getItem(draftKey) || 'null');
                if (cached?.text === text) localStorage.removeItem(draftKey);
                else if (cached && typeof cached.text === 'string') localStorage.setItem(draftKey, JSON.stringify({ text: cached.text, baseText: text }));
            } catch { /* No effect on the successful server save. */ }
            if (saved._revision) setRevision(saved._revision);
        } catch (error) {
            if (useProjectStore.getState().currentProject?.id !== projectId || (useAuthStore.getState().activeWorkspace?.id || 'local') !== workspaceId) return;
            setSaveError(getApiErrorCode(error) === "EDIT_REVISION_CONFLICT" ? t("conflict") : ts("saveFailed"));
        } finally { savingRef.current = false; setSaving(false); }
    };
    useEffect(() => {
        if (script === savedText || saving || readOnly || saveError) return;
        const timer = setTimeout(() => void save(), 1200);
        return () => clearTimeout(timer);
    }, [script, savedText, saving, readOnly, saveError]);
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (script !== savedText) { event.preventDefault(); event.returnValue = ''; }
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [script, savedText]);
    const importScript = async (file?: File) => {
        if (!file || readOnly || reading) return;
        if (!/\.(txt|md)$/i.test(file.name) || file.size > 10 * 1024 * 1024) { setSaveError(t("fileTypes")); return; }
        const projectId = currentProject?.id;
        setReading(true);
        try {
            const text = await file.text();
            if (useProjectStore.getState().currentProject?.id === projectId) changeScript(text);
        } catch { setSaveError(t("readFailed")); }
        finally { setReading(false); }
    };

    const handleAnalyze = async () => {
        if (!script.trim()) {
            toast.warning(ts("scriptEmpty"), {
                projectId: currentProject?.id,
                projectTitle: currentProject?.title,
            });
            return;
        }
        if (!currentProject?.id || isAnalyzing || leaseStatus !== "editing") return;
        const projectId = currentProject.id;
        const projectTitle = currentProject.title;
        useProjectStore.setState({ isAnalyzing: true });
        const toastId = toast.progress(ts("analyzingScript"), {
            projectId,
            projectTitle,
            body: ts("analyzingScriptBody"),
        });
        try {
            const preview = await api.extractPreview(projectId, script);
            toast.update(toastId, {
                kind: "success",
                title: ts("analysisDone"),
                body: ts("analysisDoneBody", {
                    c: preview.characters.length,
                    s: preview.scenes.length,
                    p: preview.props.length,
                }),
                autoCloseMs: 5000,
            });
            if (useProjectStore.getState().currentProject?.id !== projectId) {
                useProjectStore.setState({ isAnalyzing: false });
                return;
            }
            useProjectStore.setState({
                pendingExtraction: preview,
                pendingExtractionScript: script,
                isAnalyzing: false,
            });
        } catch (error: any) {
            useProjectStore.setState({ isAnalyzing: false });
            console.error("Failed to analyze script:", error);
            const errorMessage = error?.response?.data?.detail || error?.message || "未知错误";
            toast.update(toastId, {
                kind: "error",
                title: ts("analysisFailedShort"),
                body: String(errorMessage).slice(0, 240),
                action: {
                    label: ts("retry"),
                    onClick: () => { handleAnalyze(); },
                },
            });
        }
    };

    const { scenes, characters } = episodeAssets(currentProject);
    const scene = scenes.find(item => item.id === selectedScene) || scenes[0];
    const reference = scene?.image_url || scene?.image_asset?.variants?.find(variant => variant.id === scene.image_asset?.selected_id)?.url || scene?.image_asset?.variants?.[0]?.url;
    const outline = scenes.length ? <ol className={styles.outline}>{scenes.map((item, index) => <li key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.name}</h3><p>{item.description}</p></div></li>)}</ol> : <EmptyState title={t("emptyOutline")} description={t("analysisHint")} media={<Film size={28} />} />;
    const analysis = <section className={styles.analysis}>
        <p className={styles.eyebrow}>{t("structure")}</p><h2>{t("sceneAnalysis")}</h2><p className={styles.counts}>{t("counts", { shots: currentProject?.frames?.length || 0, characters: characters.length, scenes: scenes.length })}</p>
        {scene ? <div className={styles.scene}>
            {scenes.length > 1 && <SelectField label={t("scene")} value={scene.id} onChange={key => setSelectedScene(String(key))} options={scenes.map(item => ({ id: item.id, label: item.name }))} />}
            <h3>{scene.name}</h3>{reference && <img src={getAssetUrl(reference)} alt={scene.name} style={{ aspectRatio: getAspectRatioCssValue(currentProject?.model_settings?.scene_aspect_ratio ?? "16:9") }} />}<p>{scene.description}</p>
        </div> : <EmptyState title={t("noScenes")} description={t("analysisHint")} media={<ImageIcon size={24} />} />}
        <div className={styles.characters}><h3>{t("characters")}</h3>{characters.map(character => <article key={character.id}><strong>{character.name}</strong><p>{character.description}</p></article>)}{!characters.length && <p>{t("noCharacters")}</p>}</div>
    </section>;
    const sourceReference = <section className={styles.analysis} aria-label={t("sourceReference")}>
        <p className={styles.eyebrow}>{t("sourceReference")}</p>
        {sourceContext?.source_dependencies?.length ? <>
            <h2>{t("sourceDependencies")}</h2>
            <p className={styles.muted}>{t("sourceReferenceHint", { count: sourceContext.source_dependencies.length })}</p>
            <ul className={styles.outline}>
                {sourceContext.source_dependencies.map(item => <li key={`${String(item.source_id)}:${String(item.chapter_id)}`}>
                    <span>↳</span><div><h3>{String(item.chapter_title || item.source_title || "")}</h3><p>{String(item.source_title || "")}</p></div>
                </li>)}
            </ul>
            {sourceAnalyses.length > 0 && <>
                <h2>{t("sourceAnalysisReference")}</h2>
                <ul className={styles.outline}>
                    {sourceAnalyses.flatMap(analysis => analysis.events.slice(0, 6).map((event, index) => <li key={`${analysis.id}:${index}`}>
                        <span>{event.sequence}</span><div><h3>{event.description}</h3><p>{event.source_excerpt || event.location || ""}</p></div>
                    </li>))}
                </ul>
            </>}
            {sourceContext.stale_targets.length > 0 && <p className={styles.error}>{t("sourceStale")}</p>}
        </> : <EmptyState title={t("noSourceReference")} description={t("noSourceReferenceHint")} />}
    </section>;
    return <div className={styles.page}>
        <header className={styles.header}><div><p>{t("script")}{currentProject?.episode_number ? ` / EP.${currentProject.episode_number}` : ""}</p><h2>{currentProject?.title}</h2></div><div className={styles.actions}>
            <input ref={fileInput} type="file" accept=".txt,.md" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importScript(file); }} />
            <Button variant="quiet" onPress={() => fileInput.current?.click()} isDisabled={readOnly} isPending={reading}><Upload size={16} />{t("import")}</Button>
            <TextTierSelect projectId={currentProject?.id} isDisabled={readOnly}
                            onEffectiveModelChange={setTextModel} className={styles.tier} />
            {ratesVisible && estimatedCredits !== null && <span className={styles.tierCost}>{t("estimatedCost", { credits: estimatedCredits })}</span>}
            <Button onPress={handleAnalyze} isDisabled={readOnly || !script.trim() || reading} isPending={isAnalyzing}>{isAnalyzing ? ts("analyzingScript") : t("analyze")}</Button>
        </div></header>
        <ProductionGuide stage="script" />
        {recoveredDraft !== null && <div className={styles.recovery}>
            <span>{tw('recoverDraft')}</span>
            <Button variant="secondary" isDisabled={readOnly} onPress={() => { changeScript(recoveredDraft); setRecoveredDraft(null); }}>{tw('restoreDraft')}</Button>
            <Button variant="quiet" onPress={() => { localStorage.removeItem(draftKey); setRecoveredDraft(null); }}>{tw('dismissDraft')}</Button>
        </div>}
        <ScriptWritingEditor key={`${workspaceId}:${currentProject?.id}`} projectId={currentProject?.id || ''}
            value={script} readOnly={readOnly || reading} onChange={changeScript} onSave={() => void save()}
            outline={outline} reference={<Tabs aria-label={t("referencePanels")} items={[{ id: "analysis", label: t("structure"), content: analysis }, { id: "source", label: t("sourceReference"), content: sourceReference }, { id: "previous", label: t("previous"), content: <PreviousEpisodeSummary scriptId={currentProject?.id ?? null} /> }]} />}
            footer={<>
                <footer className={styles.status}><span role="status">{saving ? t("saving") : script !== savedText ? t("unsaved") : t("saved")}</span><span>{t("words", { count: script.length })}</span><Button variant="quiet" onPress={() => void save()} isPending={saving} isDisabled={readOnly || script === savedText}><Save size={14} />{t("save")}</Button></footer>
                {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
            </>} />
        <ReconcileModal isOpen={reconcileOpen} scriptId={currentProject?.id ?? null} onClose={() => setReconcileOpen(false)} />
    </div>;
}
