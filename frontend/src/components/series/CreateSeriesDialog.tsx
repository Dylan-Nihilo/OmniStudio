"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, Dialog, SelectField, TextAreaField, TextField } from "@omnistudio/ui";
import { api } from "@/lib/api";

export default function CreateSeriesDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const tp = useTranslations("project");
  const ts = useTranslations("series");
  const formId = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workflowMode, setWorkflowMode] = useState<"r2v" | "i2v_legacy">("r2v");
  const [contentMode, setContentMode] = useState<"scripted" | "freeform">("scripted");
  const [defaultGenerationMode, setDefaultGenerationMode] = useState<"r2v" | "i2v">("r2v");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(false);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || isCreating) return;
    setIsCreating(true);
    setError(false);
    try {
      const series = await api.createSeriesV2(title.trim(), {
        description: description.trim() || undefined,
        workflow_mode: workflowMode,
        content_mode: contentMode,
        default_generation_mode: defaultGenerationMode,
      });
      setTitle("");
      setDescription("");
      setWorkflowMode("r2v");
      setContentMode("scripted");
      setDefaultGenerationMode("r2v");
      onClose();
      window.location.hash = `#/series/${series.id}`;
    } catch { setError(true); }
    finally { setIsCreating(false); }
  };

  return <Dialog isOpen={isOpen} onOpenChange={(open) => { if (!open && !isCreating) onClose(); }}
    title={t("newSeries")} closeLabel={tc("close")} isDismissable={!isCreating}
    footer={<><Button variant="secondary" onPress={onClose} isDisabled={isCreating}>{tc("cancel")}</Button><Button type="submit" form={formId} isPending={isCreating} isDisabled={!title.trim()}>{t("createSeries")}</Button></>}>
    <form id={formId} onSubmit={handleCreate} className="grid gap-4">
      <TextField label={t("seriesTitle")} placeholder={t("seriesTitlePlaceholder")} value={title} onChange={setTitle} isRequired autoFocus isDisabled={isCreating} />
      <SelectField label={tp("workflowMode")} value={workflowMode} onChange={value => setWorkflowMode(value as typeof workflowMode)} isDisabled={isCreating}
        description={tp(workflowMode === "r2v" ? "workflowR2VDesc" : "workflowI2VDesc")}
        options={[{ id: "r2v", label: tp("workflowR2V"), description: tc("recommended") }, { id: "i2v_legacy", label: tp("workflowI2V") }]} />
      <SelectField label={tp("contentMode")} value={contentMode} onChange={value => setContentMode(value as typeof contentMode)} isDisabled={isCreating}
        description={tp(contentMode === "scripted" ? "contentScriptedDesc" : "contentFreeformDesc")}
        options={[{ id: "scripted", label: tp("contentScripted"), description: tc("recommended") }, { id: "freeform", label: tp("contentFreeform") }]} />
      <SelectField label={tp("visualControlPref")} value={defaultGenerationMode} onChange={value => setDefaultGenerationMode(value as typeof defaultGenerationMode)} isDisabled={isCreating}
        description={tp(defaultGenerationMode === "r2v" ? "visualControlR2VDesc" : "visualControlI2VDesc")}
        options={[{ id: "r2v", label: tp("visualControlR2V"), description: tc("recommended") }, { id: "i2v", label: tp("visualControlI2V") }]} />
      <TextAreaField label={t("description")} placeholder={t("descriptionPlaceholder")} value={description} onChange={setDescription} rows={3} isDisabled={isCreating} />
      {error && <p role="alert" className="text-sm text-status-failed-fg">{ts("createFailed")}</p>}
    </form>
  </Dialog>;
}
