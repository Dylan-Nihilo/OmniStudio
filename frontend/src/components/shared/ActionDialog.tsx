"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Dialog, TextField } from "@omnistudio/ui";
import ConfirmDialog from './ConfirmDialog';

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
  const [confirmClose, setConfirmClose] = useState(false);
  const close = () => {
    if (submitting.current) return;
    if (fieldLabel && value !== initialValue) setConfirmClose(true);
    else onClose();
  };
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
  return <><Dialog isOpen title={title} closeLabel={t("close")} isDismissable={!pending}
    onOpenChange={open => { if (!open) close(); }}
    footer={<><Button variant="secondary" isDisabled={pending} onPress={close}>{t("cancel")}</Button><Button type="submit" form={formId} variant={danger ? "danger" : "primary"} isPending={pending} isDisabled={pending || Boolean(fieldLabel && !value.trim())}>{confirmLabel || t("confirm")}</Button></>}>
    <form id={formId} onSubmit={submit} className="grid gap-4">
      {description && <div className="whitespace-pre-line text-sm leading-6 text-text-secondary">{description}</div>}
      {fieldLabel && <TextField autoFocus label={fieldLabel} value={value} onChange={setValue} isRequired isDisabled={pending} />}
      {error && <p role="alert" className="text-sm text-status-failed-fg">{error}</p>}
    </form>
  </Dialog><ConfirmDialog open={confirmClose} title={t('unsavedChangesTitle')} message={t('unsavedChangesMessage')}
    confirmLabel={t('discardChanges')} cancelLabel={t('keepEditing')} onCancel={() => setConfirmClose(false)} onConfirm={onClose} /></>;
}
