"use client";

import { useEffect, useState, type FormEvent } from "react";
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
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const rememberedIdentifier = window.localStorage.getItem("lumenx-remembered-identifier");
      if (rememberedIdentifier) {
        setIdentifier(rememberedIdentifier);
        setRememberMe(true);
      }
    } catch {
      // Local storage may be unavailable in hardened webviews.
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      try {
        if (rememberMe) window.localStorage.setItem("lumenx-remembered-identifier", identifier);
        else window.localStorage.removeItem("lumenx-remembered-identifier");
      } catch {
        // Remember-me is best effort and must not block authentication.
      }
      await login({ identifier, password });
      window.location.hash = consumeReturnHash("#/workspace");
    } catch {
      setError(t("errorInvalidCredentials"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main data-testid="auth-surface" className="auth-surface">
      <div className="auth-storyboard" />
      <div className="auth-shell">
        <section data-testid="auth-panel" className="auth-panel">
          <div data-testid="auth-brand" className="auth-brand">
            <LumenXBranding size="lg" variant="auth" />
            <div aria-hidden="true" className="auth-brand-rule" />
          </div>
          <div className="mb-7">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{t("loginTitle")}</h1>
            <p className="mt-1.5 text-sm leading-6 text-text-secondary">{t("loginSubtitle")}</p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">{t("identifier")}</span>
              <input className="auth-input" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required autoFocus />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">{t("password")}</span>
              <input className="auth-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required minLength={8} maxLength={128} />
            </label>

            <div className="flex items-center justify-between gap-4 pt-0.5 text-sm">
              <label className="inline-flex cursor-pointer items-center gap-2 text-text-secondary">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <span>{t("rememberMe")}</span>
              </label>
              <button
                type="button"
                onClick={() => setError(t("forgotPasswordHint"))}
                className="text-primary transition-colors hover:text-primary-hover"
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

            <button type="submit" disabled={submitting} className="auth-submit">
              {submitting ? <Loader2 className="animate-spin" size={16} /> : <LogIn size={16} />}
              {submitting ? t("loggingIn") : t("login")}
            </button>

            <p className="pt-1 text-center text-sm text-text-secondary">
              {t("noAccount")} {" "}
              <button
                type="button"
                onClick={() => setError(t("contactAdminHint"))}
                className="text-primary transition-colors hover:text-primary-hover"
              >
                {t("contactAdmin")}
              </button>
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}
