"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@omnistudio/ui";
import SettingsPage from "@/components/settings/SettingsPage";

export default function EnvConfigDialog({ isOpen, onClose, isRequired = false }: {
  isOpen: boolean;
  onClose: () => void;
  isRequired?: boolean;
}) {
  const t = useTranslations("project");
  const tc = useTranslations("common");
  const [saving, setSaving] = useState(false);
  if (!isOpen) return null;

  return <Dialog isOpen title={t("envConfig")} closeLabel={tc("close")}
    className="w-full max-w-4xl" isDismissable={!saving}
    onOpenChange={open => { if (!open && !saving) onClose(); }}>
    {isRequired && <p className="mb-4 text-sm text-text-secondary">{t("requiredHint")}</p>}
    <SettingsPage initialCategory="apikeys" onSavingChange={setSaving} onProviderConfigSaved={onClose} />
  </Dialog>;
}
