"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Dialog, TextField } from "@omnistudio/ui";

export interface ActionDialogProps {
  title: string;
  description?: ReactNode;
  fieldLabel?: string;
  initialValue?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (value: string) => Promise<void>;
  onClose: () => void;
}

export default function ActionDialog({ title, description, fieldLabel, initialValue = "", confirmLabel, danger, onConfirm, onClose }: ActionDialogProps) {
  const t = useTranslations("common");
  const formId = useId();
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || (fieldLabel && !value.trim())) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try { await onConfirm(value.trim()); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("actionFailed")); }
    finally { submitting.current = false; setPending(false); }
  };
  return <Dialog isOpen title={title} closeLabel={t("close")} isDismissable={!pending}
    onOpenChange={open => { if (!open && !submitting.current) onClose(); }}
    footer={<><Button variant="secondary" isDisabled={pending} onPress={onClose}>{t("cancel")}</Button><Button type="submit" form={formId} variant={danger ? "danger" : "primary"} isPending={pending} isDisabled={Boolean(fieldLabel && !value.trim())}>{confirmLabel || t("confirm")}</Button></>}>
    <form id={formId} onSubmit={submit} className="grid gap-4">
      {description && <div className="whitespace-pre-line text-sm leading-6 text-text-secondary">{description}</div>}
      {fieldLabel && <TextField autoFocus label={fieldLabel} value={value} onChange={setValue} isRequired isDisabled={pending} />}
      {error && <p role="alert" className="text-sm text-status-failed-fg">{error}</p>}
    </form>
  </Dialog>;
}
