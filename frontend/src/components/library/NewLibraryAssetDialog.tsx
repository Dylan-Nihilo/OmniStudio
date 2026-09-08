"use client";

import { useState, useRef, useId, type FormEvent, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { Plus, Upload } from "lucide-react";
import { Button, Dialog, SelectField, TextField, TextAreaField } from "@omnistudio/ui";
import { api } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import { toast } from "@/store/toastStore";

type AssetTab = "characters" | "scenes" | "props";

// 资产类型 → 后端单数 type（/library/assets 端点用）。
const SINGULAR: Record<AssetTab, string> = { characters: "character", scenes: "scene", props: "prop" };

interface NewLibraryAssetDialogProps {
  onClose: () => void;
  /** 创建成功后回调（父层刷新库以显示新资产）。 */
  onCreated: () => void;
}

/**
 * 资产库「新建全局资产」轻量弹窗（T6-entries）。
 * 选类型(角色/场景/道具) + 名称 + 描述 +（可选）图片（上传本地文件或填 URL）→ POST /library/assets。
 * 本地上传走 POST /library/assets/upload（multipart 字段 "file" → { image_url }），结果写入 imageUrl。
 */
export default function NewLibraryAssetDialog({ onClose, onCreated }: NewLibraryAssetDialogProps) {
  const t = useTranslations("library");
  const tc = useTranslations("common");
  const [assetType, setAssetType] = useState<AssetTab>("characters");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const [error, setError] = useState("");
  const busy = submitting || uploading;

  const typeOptions: { id: AssetTab; label: string }[] = [
    { id: "characters", label: t("characterLabel") },
    { id: "scenes", label: t("sceneLabel") },
    { id: "props", label: t("propLabel") },
  ];

  // 上传本地图片 → 后端返回 image_url，写入 imageUrl 作为创建用图。
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so re-selecting the same file fires onChange again
    if (!file || busy) return;
    setError("");
    setUploading(true);
    try {
      const { image_url } = await api.uploadLibraryImage(file);
      setImageUrl(image_url);
      toast.success(t("uploadSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(msg || t("uploadFailed"));
      toast.error(t("uploadFailed"), msg ? { body: msg } : undefined);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting || uploading) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("nameRequired"));
      setError(t("nameRequired"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await api.createLibraryAsset(SINGULAR[assetType], {
        name: trimmed,
        description: description.trim() || undefined,
        image_url: imageUrl.trim() || undefined,
      });
      toast.success(t("createSuccess"), { body: trimmed });
      onCreated();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("createFailed");
      setError(msg);
      toast.error(t("createFailed"), { body: msg });
      setSubmitting(false);
    }
  };

  return (
    <Dialog isOpen onOpenChange={open => { if (!open && !busy) onClose(); }} isDismissable={!busy}
      title={t("newAssetTitle")} closeLabel={tc("close")}
      footer={<><Button variant="secondary" onPress={onClose} isDisabled={busy}>{tc("cancel")}</Button>
        <Button type="submit" form={formId} isPending={submitting} isDisabled={uploading || !name.trim()}><Plus size={15} />{submitting ? t("creating") : tc("create")}</Button></>}>
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4" aria-busy={busy}>
        <p className="text-sm text-text-muted">{t("newAssetSubtitle")}</p>
        <SelectField label={t("assetTypeAria")} value={assetType} onChange={key => setAssetType(String(key) as AssetTab)} options={typeOptions} isDisabled={busy} />
        <TextField autoFocus label={t("nameLabel")} value={name} onChange={setName} placeholder={t("namePlaceholder")} isRequired isDisabled={busy} />
        <TextAreaField label={t("descLabel")} value={description} onChange={setDescription} placeholder={t("descPlaceholder")} rows={3} isDisabled={busy} />
        <div className="flex items-center gap-3">
          {imageUrl && <img src={getAssetUrl(imageUrl)} alt="" className="h-16 w-16 rounded-lg object-contain border border-glass-border" />}
          <input ref={fileInputRef} type="file" aria-label={t("uploadImageButton")} accept="image/*" onChange={handleFileChange} disabled={busy} className="hidden" />
          <Button variant="secondary" onPress={() => fileInputRef.current?.click()} isPending={uploading} isDisabled={submitting}><Upload size={16} />{uploading ? t("uploading") : t("uploadImageButton")}</Button>
        </div>
        <TextField label={t("imageUrlLabel")} value={imageUrl} onChange={setImageUrl} placeholder={t("imageUrlPlaceholder")} description={t("imageUrlHint")} isDisabled={busy} />
        {error && <p role="alert" className="text-sm text-status-failed-fg">{error}</p>}
      </form>
    </Dialog>
  );
}
