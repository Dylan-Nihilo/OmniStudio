"use client";

import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import LumenXBranding from "@/components/layout/LumenXBranding";
import { useAuthStore, type PasswordResetStatus } from "@/store/authStore";

const getAuthErrorCode = (error: unknown): string | null => {
  if (!axios.isAxiosError(error)) return null;
  const data = error.response?.data as { error?: { code?: string } } | undefined;
  return data?.error?.code || null;
};

export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const getPasswordResetStatus = useAuthStore((state) => state.getPasswordResetStatus);
  const resetPassword = useAuthStore((state) => state.resetPassword);
  const [status, setStatus] = useState<PasswordResetStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const loadStatus = () => {
    setStatusError(false);
    setStatus(null);
    void getPasswordResetStatus()
      .then(setStatus)
      .catch(() => setStatusError(true));
  };

  useEffect(() => {
    loadStatus();
    // Store actions are stable for the lifetime of the Zustand store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getPasswordResetStatus]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t("errorPasswordsDoNotMatch"));
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword({
        identifier,
        new_password: newPassword,
        recovery_token: status?.token_required ? recoveryToken : undefined,
      });
      setCompleted(true);
    } catch (requestError) {
      const code = getAuthErrorCode(requestError);
      if (code === "AUTH_RATE_LIMITED") setError(t("errorResetRateLimited"));
      else if (code === "AUTH_PASSWORD_POLICY") setError(t("errorPasswordPolicy"));
      else if (code === "AUTH_PASSWORD_RESET_UNAVAILABLE") setError(t("resetUnavailable"));
      else setError(t("errorResetPasswordFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const goToLogin = () => {
    window.location.hash = "#/login";
  };

  return (
    <main className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[#050508] px-5 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(100,108,255,0.2),transparent_34%),radial-gradient(circle_at_80%_82%,rgba(255,0,128,0.12),transparent_32%)]" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-7 flex justify-center"><LumenXBranding size="md" /></div>
        <section className="glass-panel rounded-2xl p-7 shadow-2xl shadow-primary/10 sm:p-9">
          {completed ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-4 text-emerald-400" size={34} />
              <h1 className="font-display text-2xl font-semibold tracking-tight">{t("resetPasswordSuccess")}</h1>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{t("resetPasswordSuccessHint")}</p>
              <button type="button" onClick={goToLogin} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110">
                <ArrowLeft size={16} />
                {t("backToLogin")}
              </button>
            </div>
          ) : statusError ? (
            <div className="text-center">
              <AlertCircle className="mx-auto mb-4 text-red-400" size={30} />
              <h1 className="font-display text-xl font-semibold">{t("resetPasswordTitle")}</h1>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{t("resetStatusFailed")}</p>
              <div className="mt-6 flex gap-3">
                <button type="button" onClick={goToLogin} className="glass-button flex-1 px-4 py-2.5 text-sm">{t("backToLogin")}</button>
                <button type="button" onClick={loadStatus} className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white">{t("retry")}</button>
              </div>
            </div>
          ) : !status ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto mb-4 animate-spin text-primary" size={28} />
              <p className="text-sm text-text-secondary">{t("loading")}</p>
            </div>
          ) : !status.available ? (
            <div className="text-center">
              <ShieldCheck className="mx-auto mb-4 text-amber-300" size={32} />
              <h1 className="font-display text-xl font-semibold">{t("resetPasswordTitle")}</h1>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{t("resetUnavailable")}</p>
              <button type="button" onClick={goToLogin} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white">
                <ArrowLeft size={16} />
                {t("backToLogin")}
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary"><KeyRound size={21} /></div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">{t("resetPasswordTitle")}</h1>
                <p className="mt-1.5 text-sm leading-6 text-text-secondary">{t("resetPasswordSubtitle")}</p>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">{t("identifier")}</span>
                  <input className="glass-input w-full" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required autoFocus />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">{t("newPassword")}</span>
                  <input className="glass-input w-full" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">{t("confirmNewPassword")}</span>
                  <input className="glass-input w-full" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} />
                </label>
                {status.token_required && (
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">{t("resetToken")}</span>
                    <input className="glass-input w-full" type="password" value={recoveryToken} onChange={(event) => setRecoveryToken(event.target.value)} autoComplete="off" required />
                    <span className="mt-1.5 block text-xs leading-5 text-text-tertiary">{t("resetTokenHint")}</span>
                  </label>
                )}

                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-5 text-text-secondary">
                  {t("localRecoveryNotice")}
                </div>

                {error && (
                  <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                    <AlertCircle className="mt-0.5 shrink-0" size={15} />
                    <span>{error}</span>
                  </div>
                )}

                <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary via-indigo-500 to-pink-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
                  {submitting ? <Loader2 className="animate-spin" size={16} /> : <KeyRound size={16} />}
                  {submitting ? t("resettingPassword") : t("resetPasswordAction")}
                </button>
                <button type="button" onClick={goToLogin} className="glass-button flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm">
                  <ArrowLeft size={15} />
                  {t("backToLogin")}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
