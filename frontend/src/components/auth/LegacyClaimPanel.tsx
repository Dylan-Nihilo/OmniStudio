"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Database,
  FileVideo2,
  FolderKanban,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { legacyClaimApi, type LegacyClaimStatus } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import OmniStudioBranding from "@/components/layout/OmniStudioBranding";
import AuthThemeMenu from "./AuthThemeMenu";

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error !== "object" || error === null) return fallback;
  const response = (error as { response?: { data?: { error?: { message?: string } } } }).response;
  return response?.data?.error?.message || fallback;
};

type Action = "preview" | "apply" | "rollback";

export default function LegacyClaimPanel() {
  const t = useTranslations("auth");
  const finishLegacyClaim = useAuthStore((state) => state.finishLegacyClaim);
  const loadFailedMessage = t("legacyClaimLoadFailed");
  const [status, setStatus] = useState<LegacyClaimStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    legacyClaimApi
      .getStatus()
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((loadError) => {
        if (active) setError(getErrorMessage(loadError, loadFailedMessage));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadFailedMessage]);

  const runAction = async (nextAction: Action) => {
    if (nextAction === "apply" && !status?.source_sha256) return;
    setAction(nextAction);
    setError(null);
    try {
      const result = nextAction === "preview"
        ? await legacyClaimApi.preview()
        : nextAction === "apply"
          ? await legacyClaimApi.apply(status!.source_sha256!)
          : await legacyClaimApi.rollback();
      setStatus(result);
    } catch (actionError) {
      setError(getErrorMessage(actionError, t("legacyClaimActionFailed")));
    } finally {
      setAction(null);
    }
  };

  const enterWorkspace = () => {
    finishLegacyClaim();
    window.location.hash = "#/workspace";
  };

  const metrics = status
    ? [
        { label: t("legacyClaimProjects"), value: status.summary.projects, icon: FolderKanban },
        { label: t("legacyClaimSeries"), value: status.summary.series, icon: Database },
        { label: t("legacyClaimMedia"), value: status.summary.media, icon: FileVideo2 },
        { label: t("legacyClaimConflicts"), value: status.summary.conflicts, icon: TriangleAlert },
      ]
    : [];

  const canApply = Boolean(
    status?.source_sha256 && (status.state === "ready" || status.state === "rolled_back"),
  );

  return (
    <main className="auth-surface">
      <div className="auth-storyboard" />
      <AuthThemeMenu />
      <div className="auth-shell auth-claim-shell">
        <div className="mb-7 flex justify-center"><OmniStudioBranding size="md" /></div>
        <section className="auth-panel auth-claim-panel overflow-hidden">
          <header className="flex items-start gap-3 border-b border-white/10 px-7 py-6 sm:px-9">
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-primary">
              <ShieldCheck size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] uppercase text-primary">{t("legacyClaimStep")}</p>
              <h1 className="mt-1 font-display text-2xl font-semibold">{t("legacyClaimTitle")}</h1>
              <p className="mt-1.5 text-sm leading-6 text-text-secondary">{t("legacyClaimSubtitle")}</p>
            </div>
            <button
              type="button"
              title={t("legacyClaimRefresh")}
              aria-label={t("legacyClaimRefresh")}
              disabled={loading || action !== null}
              onClick={() => void runAction("preview")}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-text-secondary transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
            >
              <RefreshCw className={action === "preview" ? "animate-spin" : ""} size={16} />
            </button>
          </header>

          <div className="px-7 py-6 sm:px-9">
            {loading ? (
              <div className="flex min-h-44 items-center justify-center gap-3 text-sm text-text-secondary">
                <Loader2 className="animate-spin text-primary" size={20} />
                {t("legacyClaimLoading")}
              </div>
            ) : status ? (
              <>
                <div className="grid grid-cols-2 border-y border-white/10 sm:grid-cols-4">
                  {metrics.map(({ label, value, icon: Icon }, index) => (
                    <div
                      key={label}
                      className={`px-3 py-4 ${index % 2 ? "border-l" : ""} ${index > 1 ? "border-t sm:border-t-0" : ""} sm:border-l sm:first:border-l-0 border-white/10`}
                    >
                      <div className="flex items-center gap-2 text-text-muted">
                        <Icon size={14} />
                        <span className="text-xs">{label}</span>
                      </div>
                      <strong className="mt-2 block font-mono text-2xl font-semibold text-foreground">{value}</strong>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                  {status.state === "claimed" ? (
                    <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-400" size={18} />
                  ) : status.state === "blocked" ? (
                    <AlertCircle className="mt-0.5 shrink-0 text-amber-400" size={18} />
                  ) : status.state === "rolled_back" ? (
                    <RotateCcw className="mt-0.5 shrink-0 text-amber-300" size={18} />
                  ) : (
                    <Database className="mt-0.5 shrink-0 text-primary" size={18} />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {status.state === "claimed"
                        ? t("legacyClaimClaimed")
                        : status.state === "blocked"
                          ? t("legacyClaimBlocked")
                          : status.state === "rolled_back"
                            ? t("legacyClaimRolledBack")
                            : t("legacyClaimReady")}
                    </p>
                    {status.source_sha256 ? (
                      <p className="mt-1 truncate font-mono text-[11px] text-text-muted" title={status.source_sha256}>
                        SHA-256 · {status.source_sha256}
                      </p>
                    ) : null}
                  </div>
                </div>

                {status.diagnostics.length > 0 ? (
                  <div role="alert" className="mt-4 space-y-1 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-100">
                    {status.diagnostics.slice(0, 4).map((item, index) => (
                      <p key={`${item.type}-${index}`}>{item.message || item.type}</p>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

            {error ? (
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                <AlertCircle className="mt-0.5 shrink-0" size={15} />
                <span>{error}</span>
              </div>
            ) : null}

            {!loading ? (
              <footer className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                {status?.rollback_available ? (
                  <button
                    type="button"
                    disabled={action !== null}
                    onClick={() => void runAction("rollback")}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-text-secondary transition hover:border-amber-300/30 hover:text-amber-200 disabled:opacity-50"
                  >
                    {action === "rollback" ? <Loader2 className="animate-spin" size={15} /> : <RotateCcw size={15} />}
                    {t("legacyClaimRollback")}
                  </button>
                ) : <span />}

                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={enterWorkspace}
                    className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm text-text-secondary transition hover:bg-white/5 hover:text-foreground"
                  >
                    {status?.state === "claimed" ? t("legacyClaimEnterWorkspace") : t("legacyClaimLater")}
                    <ArrowRight size={15} />
                  </button>
                  {canApply ? (
                    <button
                      type="button"
                      disabled={action !== null}
                      onClick={() => void runAction("apply")}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition hover:brightness-110 disabled:opacity-50"
                    >
                      {action === "apply" ? <Loader2 className="animate-spin" size={15} /> : <ShieldCheck size={15} />}
                      {t("legacyClaimApply")}
                    </button>
                  ) : null}
                </div>
              </footer>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
