"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuthStore } from "@/store/authStore";
import { AUTH_EXPIRED_EVENT, isSafeReturnHash, rememberReturnHash } from "@/lib/apiClient";
import OmniStudioBranding from "@/components/layout/OmniStudioBranding";
import LoginPage from "./LoginPage";
import ResetPasswordPage from "./ResetPasswordPage";
import SetupPage from "./SetupPage";
import InvitationRegisterPage from "./InvitationRegisterPage";
import InvitationAcceptPage from "./InvitationAcceptPage";

const RESET_PASSWORD_HASH = "#/reset-password";
const invitationToken = (hash: string): string | null => {
  if (!hash.startsWith("#/invite/")) return null;
  try {
    return decodeURIComponent(hash.slice("#/invite/".length)) || null;
  } catch {
    return null;
  }
};

function AuthSurface({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[#050508] px-5 py-10 text-foreground">
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 20% 15%, rgba(100,108,255,0.18), transparent 32%), radial-gradient(circle at 82% 78%, rgba(255,0,128,0.12), transparent 34%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:42px_42px] [mask-image:radial-gradient(circle_at_center,black,transparent_78%)]" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-7 flex justify-center">
          <OmniStudioBranding size="md" />
        </div>
        {children}
      </div>
    </main>
  );
}

export function AuthLoadingScreen() {
  const t = useTranslations("auth");
  return (
    <AuthSurface>
      <div className="glass-panel rounded-2xl px-6 py-10 text-center shadow-2xl shadow-primary/10">
        <Loader2 className="mx-auto mb-4 animate-spin text-primary" size={28} />
        <p className="text-sm text-text-secondary">{t("loading")}</p>
      </div>
    </AuthSurface>
  );
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const t = useTranslations("auth");
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const bootstrapping = useAuthStore((state) => state.bootstrapping);
  const setupStatus = useAuthStore((state) => state.setupStatus);
  const user = useAuthStore((state) => state.user);
  const legacyClaimPending = useAuthStore((state) => state.legacyClaimPending);
  const [bootstrapError, setBootstrapError] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [currentHash, setCurrentHash] = useState(() =>
    typeof window === "undefined" ? "#/login" : window.location.hash || "#/workspace",
  );

  const runBootstrap = () => {
    setBootstrapError(false);
    void bootstrap().catch(() => setBootstrapError(true));
  };

  useEffect(() => {
    runBootstrap();
    // bootstrap is stable for the lifetime of the Zustand store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap]);

  useEffect(() => {
    const updateHash = () => setCurrentHash(window.location.hash || "#/workspace");
    updateHash();
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => {
      setAuthExpired(true);
      const hash = window.location.hash || "#/workspace";
      if (isSafeReturnHash(hash)) rememberReturnHash(hash);
      if (hash !== "#/login") window.location.hash = "#/login";
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  useEffect(() => {
    if (user && authExpired) setAuthExpired(false);
  }, [authExpired, user]);

  useEffect(() => {
    if (bootstrapping || bootstrapError || !setupStatus || authExpired) return;

    if (!setupStatus.initialized) {
      if (currentHash !== "#/setup") window.location.hash = "#/setup";
      return;
    }

    if (!user) {
      if (invitationToken(currentHash)) return;
      if (currentHash === RESET_PASSWORD_HASH) return;
      if (isSafeReturnHash(currentHash)) rememberReturnHash(currentHash);
      if (currentHash !== "#/login") window.location.hash = "#/login";
      return;
    }

    if (legacyClaimPending) {
      if (currentHash !== "#/setup") window.location.hash = "#/setup";
      return;
    }

    if (currentHash === "#/login" || currentHash === "#/setup" || currentHash === RESET_PASSWORD_HASH) {
      window.location.hash = "#/workspace";
    }

  }, [authExpired, bootstrapError, bootstrapping, currentHash, legacyClaimPending, setupStatus, user]);

  if (bootstrapping) return <AuthLoadingScreen />;

  // Auth expiry is a hard boundary: do not render protected content while the
  // persisted identity is being invalidated and the hash moves to login.
  if (authExpired) return <LoginPage />;

  if (bootstrapError) {
    return (
      <AuthSurface>
        <div className="glass-panel rounded-2xl border-red-500/25 p-7 text-center shadow-2xl shadow-black/30">
          <AlertCircle className="mx-auto mb-4 text-red-400" size={28} />
          <h1 className="font-display text-xl font-semibold">{t("bootstrapFailed")}</h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{t("bootstrapFailedHint")}</p>
          <button
            type="button"
            onClick={runBootstrap}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <RefreshCw size={15} />
            {t("retry")}
          </button>
        </div>
      </AuthSurface>
    );
  }

  if (!setupStatus?.initialized) return <SetupPage />;
  const inviteToken = invitationToken(currentHash);
  if (!user && inviteToken) {
    return <AuthSurface><InvitationRegisterPage token={inviteToken} /></AuthSurface>;
  }
  if (!user && currentHash === RESET_PASSWORD_HASH) return <ResetPasswordPage />;
  if (!user) return <LoginPage />;
  if (legacyClaimPending) return <SetupPage />;
  if (inviteToken) return <AuthSurface><InvitationAcceptPage token={inviteToken} /></AuthSurface>;
  return <>{children}</>;
}
