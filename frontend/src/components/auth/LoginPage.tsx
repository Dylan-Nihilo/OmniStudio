"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, Loader2, LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { consumeReturnHash } from "@/lib/apiClient";
import { useAuthStore } from "@/store/authStore";
import LumenXBranding from "@/components/layout/LumenXBranding";

export default function LoginPage() {
  const t = useTranslations("auth");
  const login = useAuthStore((state) => state.login);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ identifier, password });
      window.location.hash = consumeReturnHash("#/workspace");
    } catch {
      setError(t("errorInvalidCredentials"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[#050508] px-5 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(100,108,255,0.2),transparent_34%),radial-gradient(circle_at_80%_82%,rgba(255,0,128,0.12),transparent_32%)]" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-7 flex justify-center"><LumenXBranding size="md" /></div>
        <section className="glass-panel rounded-2xl p-7 shadow-2xl shadow-primary/10 sm:p-9">
          <div className="mb-7">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{t("loginTitle")}</h1>
            <p className="mt-1.5 text-sm leading-6 text-text-secondary">{t("loginSubtitle")}</p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">{t("identifier")}</span>
              <input className="glass-input w-full" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required autoFocus />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">{t("password")}</span>
              <input className="glass-input w-full" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required minLength={8} maxLength={128} />
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { window.location.hash = "#/reset-password"; }}
                className="text-sm font-medium text-primary transition hover:text-primary/80"
              >
                {t("forgotPassword")}
              </button>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                <AlertCircle className="mt-0.5 shrink-0" size={15} />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary via-indigo-500 to-pink-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? <Loader2 className="animate-spin" size={16} /> : <LogIn size={16} />}
              {submitting ? t("loggingIn") : t("login")}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
