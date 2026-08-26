"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, KeyRound, Loader2, X } from "lucide-react";
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const submittingRef = useRef(submitting);
  onCloseRef.current = onClose;
  submittingRef.current = submitting;

  useEffect(() => {
    if (!isOpen) return;
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="glass-panel w-full max-w-md rounded-2xl p-6 shadow-2xl shadow-black/40">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-2 text-primary"><KeyRound size={18} /></div>
            <h2 id={titleId} className="font-display text-xl font-semibold">{t("changePassword")}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg p-2 text-text-muted transition hover:bg-hover-bg hover:text-foreground" aria-label={tc("close")}><X size={18} /></button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">{t("oldPassword")}</span>
            <input className="glass-input w-full" type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} autoComplete="current-password" required minLength={8} maxLength={128} autoFocus />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">{t("newPassword")}</span>
            <input className="glass-input w-full" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">{t("confirmNewPassword")}</span>
            <input className="glass-input w-full" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} />
          </label>
          <p className="text-xs text-text-muted">{t("passwordRequirements")}</p>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
              <AlertCircle className="mt-0.5 shrink-0" size={15} />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={submitting} className="glass-button text-sm">{tc("cancel")}</button>
            <button type="submit" disabled={submitting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60">
              {submitting && <Loader2 className="animate-spin" size={15} />}
              {tc("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
