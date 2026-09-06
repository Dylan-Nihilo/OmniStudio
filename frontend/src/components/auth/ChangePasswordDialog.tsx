"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Button, Dialog, PasswordField } from "@omnistudio/ui";
import { useTranslations } from "next-intl";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";

interface ChangePasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangePasswordDialog({ isOpen, onClose }: ChangePasswordDialogProps) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const changePassword = useAuthStore((state) => state.changePassword);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  useEffect(() => {
    if (!isOpen) return;
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t("errorPasswordsDoNotMatch"));
      return;
    }

    setSubmitting(true);
    try {
      await changePassword({ current_password: oldPassword, new_password: newPassword });
      toast.success(t("passwordChanged"));
      onClose();
      window.location.hash = "#/login";
    } catch {
      setError(t("errorChangePasswordFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => { if (!open && !submitting) onClose(); }} isDismissable={!submitting}
      title={t("changePassword")} closeLabel={tc("close")}
      footer={<><Button variant="secondary" onPress={onClose} isDisabled={submitting}>{tc("cancel")}</Button><Button type="submit" form={formId} isPending={submitting}>{tc("save")}</Button></>}>
      <form id={formId} onSubmit={handleSubmit} className="grid gap-4">
        <PasswordField label={t("oldPassword")} value={oldPassword} onChange={setOldPassword} autoComplete="current-password" isRequired minLength={8} maxLength={128} autoFocus isDisabled={submitting} showPasswordLabel={t("showPassword")} hidePasswordLabel={t("hidePassword")} />
        <PasswordField label={t("newPassword")} value={newPassword} onChange={setNewPassword} autoComplete="new-password" isRequired minLength={8} maxLength={128} isDisabled={submitting} showPasswordLabel={t("showPassword")} hidePasswordLabel={t("hidePassword")} />
        <PasswordField label={t("confirmNewPassword")} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" isRequired minLength={8} maxLength={128} isDisabled={submitting} showPasswordLabel={t("showPassword")} hidePasswordLabel={t("hidePassword")} />
        <p className="text-xs text-text-muted">{t("passwordRequirements")}</p>
        {error && <p role="alert" className="text-sm text-status-failed-fg">{error}</p>}
      </form>
    </Dialog>
  );
}
