"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Film, Upload, Save, Image as ImageIcon } from "lucide-react";
import { Button, EmptyState, SelectField, Tabs } from "@omnistudio/ui";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { toast } from "@/store/toastStore";
import PreviousEpisodeSummary from "@/components/modules/PreviousEpisodeSummary";
import ReconcileModal from "@/components/modules/ReconcileModal";
import { getApiErrorCode } from "@/lib/apiClient";
import { getAssetUrl } from "@/lib/utils";
import { useEditLeaseStore } from "@/store/editLeaseStore";
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
    const gutter = useRef<HTMLDivElement>(null);
    const readOnly = leaseStatus !== "editing";

    useEffect(() => {
        setScript(projectText);
        setSavedText(projectText);
        setSaveError(null);
    }, [currentProject?.id]);
    useEffect(() => {
        const open = () => setReconcileOpen(true);
        document.addEventListener("omni_studio:openReconcile", open);
        return () => document.removeEventListener("omni_studio:openReconcile", open);
    }, []);

    const changeScript = (text: string) => {
        setScript(text);
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
            if (useProjectStore.getState().currentProject?.id !== projectId) return;
            setSavedText(text);
            if (saved._revision) setRevision(saved._revision);
        } catch (error) {
            if (useProjectStore.getState().currentProject?.id !== projectId) return;
            setSaveError(getApiErrorCode(error) === "EDIT_REVISION_CONFLICT" ? t("conflict") : ts("saveFailed"));
        } finally { savingRef.current = false; setSaving(false); }
    };
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

    const scenes = currentProject?.scenes || [];
    const characters = currentProject?.characters || [];
    const scene = scenes.find(item => item.id === selectedScene) || scenes[0];
    const reference = scene?.image_url || scene?.image_asset?.variants?.find(variant => variant.id === scene.image_asset?.selected_id)?.url || scene?.image_asset?.variants?.[0]?.url;
    const outline = scenes.length ? <ol className={styles.outline}>{scenes.map((item, index) => <li key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.name}</h3><p>{item.description}</p></div></li>)}</ol> : <EmptyState title={t("emptyOutline")} description={t("analysisHint")} media={<Film size={28} />} />;
    const editor = <div className={styles.editor}>
        <div ref={gutter} className={styles.gutter} aria-hidden="true">{script.split("\n").map((_: string, index: number) => <div key={index}>{String(index + 1).padStart(3, "0")}</div>)}</div>
        <textarea aria-label={ts("scriptEditor")} value={script} onChange={event => changeScript(event.target.value)} onBlur={() => void save()} onScroll={event => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }} readOnly={readOnly || reading} placeholder={ts("scriptPlaceholder")} wrap="off" spellCheck={false} />
    </div>;
    const analysis = <section className={styles.analysis}>
        <p className={styles.eyebrow}>{t("structure")}</p><h2>{t("sceneAnalysis")}</h2><p className={styles.counts}>{t("counts", { shots: currentProject?.frames?.length || 0, characters: characters.length, scenes: scenes.length })}</p>
        {scene ? <div className={styles.scene}>
            {scenes.length > 1 && <SelectField label={t("scene")} value={scene.id} onChange={key => setSelectedScene(String(key))} options={scenes.map(item => ({ id: item.id, label: item.name }))} />}
            <h3>{scene.name}</h3>{reference && <img src={getAssetUrl(reference)} alt={scene.name} />}<p>{scene.description}</p>
        </div> : <EmptyState title={t("noScenes")} description={t("analysisHint")} media={<ImageIcon size={24} />} />}
        <div className={styles.characters}><h3>{t("characters")}</h3>{characters.map(character => <article key={character.id}><strong>{character.name}</strong><p>{character.description}</p></article>)}{!characters.length && <p>{t("noCharacters")}</p>}</div>
    </section>;
    return <div className={styles.page}>
        <header className={styles.header}><div><p>{t("script")}{currentProject?.episode_number ? ` / EP.${currentProject.episode_number}` : ""}</p><h2>{currentProject?.title}</h2></div><div className={styles.actions}>
            <input ref={fileInput} type="file" accept=".txt,.md" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importScript(file); }} />
            <Button variant="quiet" onPress={() => fileInput.current?.click()} isDisabled={readOnly} isPending={reading}><Upload size={16} />{t("import")}</Button>
            <Button onPress={handleAnalyze} isDisabled={readOnly || !script.trim() || reading} isPending={isAnalyzing}>{isAnalyzing ? ts("analyzingScript") : t("analyze")}</Button>
        </div></header>
        <div className={styles.panels}>
            <section className={styles.paper}>
                <Tabs aria-label={t("editorView")} className={styles.editorTabs} defaultSelectedKey="script" items={[{ id: "outline", label: t("outline"), content: outline }, { id: "script", label: t("script"), content: editor }]} />
                <footer className={styles.status}><span role="status">{saving ? t("saving") : script !== savedText ? t("unsaved") : t("saved")}</span><span>{t("words", { count: script.length })}</span><Button variant="quiet" onPress={() => void save()} isPending={saving} isDisabled={readOnly || script === savedText}><Save size={14} />{t("save")}</Button></footer>
                {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
            </section>
            <aside className={styles.rail}><Tabs aria-label={t("referencePanels")} items={[{ id: "analysis", label: t("structure"), content: analysis }, { id: "previous", label: t("previous"), content: <PreviousEpisodeSummary scriptId={currentProject?.id ?? null} /> }]} /></aside>
        </div>
        <ReconcileModal isOpen={reconcileOpen} scriptId={currentProject?.id ?? null} onClose={() => setReconcileOpen(false)} />
    </div>;
}
