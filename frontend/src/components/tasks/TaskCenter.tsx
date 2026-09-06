"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { api, type UnifiedJob, type UnifiedTaskDetail, type UnifiedTaskSummary } from "@/lib/api";
import TaskCenterRow from "./TaskCenterRow";
import { toTaskViewModel, type TaskObjectRef } from "./taskCenterModel";

export default function TaskCenter({ workspaceId, projectId, episodeId, onOpenObject, onClose, onSummaryChange }: {
  workspaceId: string;
  projectId?: string;
  episodeId?: string;
  onOpenObject: (ref: TaskObjectRef) => void;
  onClose: () => void;
  onSummaryChange?: (summary: UnifiedTaskSummary) => void;
}) {
  const t = useTranslations("taskCenter");
  const [jobs, setJobs] = useState<UnifiedJob[]>([]);
  const [summary, setSummary] = useState<UnifiedTaskSummary | null>(null);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<UnifiedTaskDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = { workspace_id: workspaceId, project_id: projectId, episode_id: episodeId, status: status || undefined, q: query || undefined, page, page_size: 10 } as Parameters<typeof api.listTasks>[0];
      const [result, nextSummary] = await Promise.all([api.listTasks(filters), api.getTaskSummary({ project_id: projectId, episode_id: episodeId })]);
      setJobs(result.items ?? []);
      setTotal(result.total ?? 0);
      setSummary(nextSummary);
      onSummaryChange?.(nextSummary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "loadFailed");
    } finally {
      setLoading(false);
    }
  }, [episodeId, onSummaryChange, page, projectId, query, status, workspaceId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!summary?.running) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load, summary?.running]);

  const rows = useMemo(() => jobs.map(toTaskViewModel), [jobs]);
  const pageCount = Math.max(1, Math.ceil(total / 10));
  const runAction = async (fn: () => Promise<unknown>) => { await fn(); await load(); };

  return (
    <section className="min-h-full bg-background px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><button type="button" onClick={onClose} className="mb-3 inline-flex items-center gap-1 text-xs text-text-muted hover:text-foreground"><ArrowLeft size={14} /> {t("back")}</button><h1 className="font-display text-2xl text-foreground">{t("title")}</h1><p className="mt-1 text-sm text-text-secondary">{t("subtitle")}</p></div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-glass-border px-3 py-2 text-sm text-text-secondary hover:bg-hover-bg"><RefreshCw size={15} /> {t("refresh")}</button>
        </header>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([["running", summary?.running ?? 0], ["failed", summary?.failed ?? 0], ["succeeded", summary?.succeeded ?? 0], ["total", summary?.total ?? 0]] as const).map(([key, value]) => <div key={key} className="rounded-xl border border-glass-border bg-surface/50 px-3 py-3"><p className="text-xs text-text-muted">{t(key)}</p><p className="mt-1 font-mono text-xl text-foreground">{value}</p></div>)}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("searchPlaceholder")} className="glass-input w-full pl-9" /></label><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label={t("statusFilter")} className="glass-input sm:w-44"><option value="">{t("all")}</option>{["pending", "processing", "succeeded", "failed", "canceled"].map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></div>
        {loading && <p className="py-12 text-center text-sm text-text-muted">{t("loading")}</p>}
        {!loading && error && <div className="mt-6 rounded-xl border border-status-failed-border bg-status-failed-bg p-4 text-sm text-status-failed-fg"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-2 rounded-md border border-status-failed-border px-3 py-1.5 text-xs font-medium hover:bg-status-failed-fg/10">{t("retry")}</button></div>}
        {!loading && !error && rows.length === 0 && <div className="mt-6 rounded-xl border border-dashed border-glass-border px-4 py-16 text-center"><p className="text-sm text-text-secondary">{t("empty")}</p><p className="mt-1 text-xs text-text-muted">{t("emptyHint")}</p></div>}
        {!loading && !error && rows.length > 0 && <div className="mt-6 space-y-3">{rows.map((task) => <TaskCenterRow key={task.id} task={task} onCancel={() => { if (window.confirm(t("confirmCancel"))) void runAction(() => api.cancelTask(task.id)); }} onRetry={() => void runAction(() => api.retryTask(task.id, jobs.find((job) => job.id === task.id)?.items.filter((item) => item.status === "failed").map((item) => item.id)))} onDetails={() => void api.getTask(task.id).then(setSelectedJob)} onOpenObject={() => onOpenObject(task.objectRef)} />)}</div>}
        <div className="mt-6 flex items-center justify-between text-xs text-text-muted"><span>{t("page", { page, total: pageCount })}</span><div className="flex gap-1"><button type="button" aria-label={t("previousPage")} disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-md p-2 hover:bg-hover-bg disabled:opacity-40"><ChevronLeft size={16} /></button><button type="button" aria-label={t("nextPage")} disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-md p-2 hover:bg-hover-bg disabled:opacity-40"><ChevronRight size={16} /></button></div></div>
      </div>
      {selectedJob && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true"><div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-glass-border bg-elevated p-5"><div className="flex items-center justify-between"><h2 className="font-display text-lg text-foreground">{t("details")}</h2><button type="button" aria-label={t("close")} onClick={() => setSelectedJob(null)} className="rounded-md p-2 text-text-muted hover:bg-hover-bg"><X size={16} /></button></div><div className="mt-4 space-y-2 text-sm">{selectedJob.events.length ? selectedJob.events.map((event) => <div key={event.id} className="rounded-lg border border-glass-border p-3"><span className="text-text-muted">{event.from_status ?? "-"} → </span><span className="text-foreground">{event.to_status}</span>{event.error_code && <span className="ml-2 text-status-failed-fg">{event.error_code}</span>}</div>) : <p className="text-text-muted">{t("noEvents")}</p>}</div></div></div>}
    </section>
  );
}
