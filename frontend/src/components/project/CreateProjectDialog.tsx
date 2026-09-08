"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, Dialog, SelectField, Tabs, TextAreaField, TextField } from "@omnistudio/ui";
import { useProjectStore } from "@/store/projectStore";
import { projectHref } from "@/lib/workspaceOverview";
import styles from "./CreateProjectDialog.module.css";

interface CreateProjectDialogProps {
    isOpen: boolean;
    onClose: () => void;
    seriesId?: string;
    seriesTitle?: string;
}

export default function CreateProjectDialog({ isOpen, onClose, seriesId, seriesTitle }: CreateProjectDialogProps) {
    const [title, setTitle] = useState("");
    const [text, setText] = useState("");
    const [workflowMode, setWorkflowMode] = useState<"r2v" | "i2v_legacy">("r2v");
    const [isCreating, setIsCreating] = useState(false);
    const [isReading, setIsReading] = useState(false);
    const [error, setError] = useState("");
    const createProject = useProjectStore((state) => state.createProject);
    const t = useTranslations("project");
    const tc = useTranslations("common");
    const formId = useId();
    const fileId = useId();
    const busy = isCreating || isReading;

    const readFile = async (file: File | undefined) => {
        if (!file || busy) return;
        setError("");
        if (!/\.(txt|md)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
            setError(t("scriptFileRequirements"));
            return;
        }
        setIsReading(true);
        try {
            setText(await file.text());
            if (!title.trim()) setTitle(file.name.replace(/\.(txt|md)$/i, ""));
        } catch {
            setError(t("scriptFileReadFailed"));
        } finally {
            setIsReading(false);
        }
    };

    const handleCreate = async (event: FormEvent) => {
        event.preventDefault();
        if (busy || !title.trim()) return;
        setIsCreating(true);
        setError("");
        try {
            await createProject(title.trim(), text, true, workflowMode, seriesId);
            const currentProject = useProjectStore.getState().currentProject;
            if (currentProject) window.location.hash = projectHref(currentProject);
            onClose();
        } catch (error: any) {
            const detail = error?.response?.data?.detail;
            setError(t("createFailed", { error: typeof detail === "string" ? detail : error?.message || t("checkBackend") }));
        } finally {
            setIsCreating(false);
        }
    };

    const scriptField = <TextAreaField label={t("scriptContent")} value={text} onChange={setText} placeholder={t("scriptPlaceholder")} rows={3} isDisabled={busy} />;
    return (
        <Dialog isOpen={isOpen} onOpenChange={(open) => { if (!open && !busy) onClose(); }} isDismissable={!busy}
            className={styles.dialog} title={t("createTitle")} closeLabel={tc("close")}
            footer={<><Button variant="secondary" onPress={onClose} isDisabled={busy}>{tc("cancel")}</Button><Button type="submit" form={formId} isPending={isCreating} isDisabled={isReading || !title.trim()}>{isCreating ? t("creating") : t("createProject")}</Button></>}>
            <form id={formId} onSubmit={handleCreate} className={styles.form} aria-busy={busy}>
                <p className={styles.description}>{t("createDescription")}</p>
                {seriesId && <p className={styles.series}>{t("series")} · {seriesTitle}</p>}
                <TextField autoFocus label={t("projectTitle")} value={title} onChange={setTitle} placeholder={t("projectTitlePlaceholder")} isRequired isDisabled={busy} />
                <Tabs aria-label={t("scriptSource")} items={[
                    { id: "paste", label: t("pasteScript"), content: scriptField, isDisabled: busy },
                    { id: "upload", label: t("uploadScript"), isDisabled: busy, content: <div className={styles.upload}>
                        <label htmlFor={fileId}>{t("scriptFileRequirements")}</label>
                        <input id={fileId} type="file" accept=".txt,.md,text/plain,text/markdown" disabled={busy} onChange={(event) => { void readFile(event.target.files?.[0]); }} />
                        {isReading ? <p role="status">{t("readingScript")}</p> : scriptField}
                    </div> },
                ]} />
                <details className={styles.workflow}><summary>{t("workflowMode")} · {t(workflowMode === "r2v" ? "workflowR2V" : "workflowI2V")}</summary>
                    <SelectField label={t("workflowMode")} value={workflowMode} onChange={(value) => { if (value === "r2v" || value === "i2v_legacy") setWorkflowMode(value); }} isDisabled={busy}
                        options={[{ id: "r2v", label: t("workflowR2V"), description: t("workflowR2VDesc") }, { id: "i2v_legacy", label: t("workflowI2V"), description: t("workflowI2VDesc") }]} />
                </details>
                {error && <p role="alert" className={styles.error}>{error}</p>}
            </form>
        </Dialog>
    );
}
