"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuthStore } from "@/store/authStore";
import LumenXBranding from "@/components/layout/LumenXBranding";

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error !== "object" || error === null) return fallback;
  const response = (error as { response?: { data?: { error?: { message?: string } } } }).response;
  return response?.data?.error?.message || fallback;
};

export default function SetupPage() {
  const t = useTranslations("auth");
  const setup = useAuthStore((state) => state.setup);
  const setupStatus = useAuthStore((state) => state.setupStatus);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError(t("errorPasswordsDoNotMatch"));
      return;
    }

    setSubmitting(true);
    try {
      await setup({ username, email, password, setup_token: setupToken });
      window.location.hash = "#/workspace";
    } catch (submitError) {
      setError(getErrorMessage(submitError, t("errorSetupFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex h-screen w-screen items-center justify-center overflow-y-auto bg-[#050508] px-5 py-10 text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_15%,rgba(100,108,255,0.2),transparent_34%),radial-gradient(circle_at_82%_80%,rgba(255,0,128,0.13),transparent_32%)]" />
      <div className="relative z-10 w-full max-w-lg">
        <div className="mb-7 flex justify-center"><LumenXBranding size="md" /></div>
        <section className="glass-panel rounded-2xl p-7 shadow-2xl shadow-primary/10 sm:p-9">
          <div className="mb-7 flex items-start gap-3">
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-2.5 text-primary"><ShieldCheck size={22} /></div>
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight">{t("setupTitle")}</h1>
              <p className="mt-1.5 text-sm leading-6 text-text-secondary">{t("setupSubtitle")}</p>
            </div>
          </div>

          {setupStatus && !setupStatus.setup_allowed ? (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
              {t("setupNotAllowed")}
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{t("username")}</span>
                <input className="glass-input w-full" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required maxLength={128} autoFocus />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{t("email")}</span>
                <input className="glass-input w-full" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">{t("password")}</span>
                  <input className="glass-input w-full" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">{t("confirmPassword")}</span>
                  <input className="glass-input w-full" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} />
                </label>
              </div>
              <p className="-mt-1 text-xs text-text-muted">{t("passwordRequirements")}</p>
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between gap-3 text-sm font-medium">
                  <span>{t("setupToken")}</span>
                  <span className="text-xs font-normal text-text-muted">{t("optional")}</span>
                </span>
                <input className="glass-input w-full font-mono" type="password" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} autoComplete="off" />
                <span className="mt-1.5 block text-xs leading-5 text-text-muted">{t("setupTokenHint")}</span>
              </label>

              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                  <AlertCircle className="mt-0.5 shrink-0" size={15} />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary via-indigo-500 to-pink-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
                {submitting && <Loader2 className="animate-spin" size={16} />}
                {submitting ? t("settingUp") : t("setupAction")}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
