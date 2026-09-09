"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Dialog, EmptyState, IconButton, LoadingState, SelectField, TextField } from "@omnistudio/ui";
import { api, type UnifiedJob, type UnifiedTaskDetail, type UnifiedTaskSummary } from "@/lib/api";
import ActionDialog from "@/components/shared/ActionDialog";
import TaskCenterRow from "./TaskCenterRow";
import { toTaskViewModel, type TaskObjectRef } from "./taskCenterModel";
import styles from "./TaskCenter.module.css";

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<UnifiedTaskDetail | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const request = useRef(0);
  const actionRequest = useRef(0);
  const busy = useRef(false);

  const load = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const filters = { workspace_id: workspaceId, project_id: projectId, episode_id: episodeId, status: status || undefined, q: query || undefined, page, page_size: 10 };
      const [result, nextSummary] = await Promise.all([api.listTasks(filters), api.getTaskSummary({ project_id: projectId, episode_id: episodeId })]);
      if (version !== request.current) return false;
      setJobs(result.items ?? []);
      setTotal(result.total ?? 0);
      setSummary(nextSummary);
      onSummaryChange?.(nextSummary);
      return nextSummary.running > 0;
    } catch (cause) {
      if (version === request.current) setError(cause instanceof Error ? cause.message : t("loadFailed"));
      return false;
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [episodeId, onSummaryChange, page, projectId, query, status, workspaceId, t]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);
  useEffect(() => {
    if (loading || !summary?.running) return;
    const timer = setTimeout(() => void load(), 5000);
    return () => clearTimeout(timer);
  }, [loading, summary?.running, load]);
  useEffect(() => {
    setJobs([]); setSummary(null); setSelectedJob(null); setCancelId(null); setActionError(null); setBusyId(null); busy.current = false;
    return () => { actionRequest.current += 1; };
  }, [workspaceId, projectId, episodeId]);

  const rows = useMemo(() => jobs.map(toTaskViewModel), [jobs]);
  const pageCount = Math.max(1, Math.ceil(total / 10));
  const runAction = async (id: string, action: "retry" | "details") => {
    if (busy.current) return;
    busy.current = true; setBusyId(id); setActionError(null);
    const version = ++actionRequest.current;
    try {
      if (action === "details") {
        const detail = await api.getTask(id);
        if (version === actionRequest.current) setSelectedJob(detail);
      } else {
        await api.retryTask(id, jobs.find(job => job.id === id)?.items.filter(item => item.status === "failed").map(item => item.id));
        if (version === actionRequest.current) await load();
      }
    } catch (cause) {
      if (version === actionRequest.current) setActionError(cause instanceof Error ? cause.message : t("loadFailed"));
    } finally { if (version === actionRequest.current) { busy.current = false; setBusyId(null); } }
  };

  return <section className={styles.page}>
    <header className={styles.header}>
      <div><Button variant="quiet" onPress={onClose}><ArrowLeft size={14} />{t("back")}</Button><h1>{t("title")}</h1><p>{t("subtitle")}</p></div>
      <Button variant="secondary" onPress={() => void load()} isPending={loading}><RefreshCw size={16} />{t("refresh")}</Button>
    </header>
    <dl className={styles.summary}>{(["running", "failed", "succeeded", "total"] as const).map(key => <div key={key}><dt>{t(key)}</dt><dd>{summary ? summary[key] : "—"}</dd></div>)}</dl>
    <div className={styles.filters}>
      <TextField label={t("searchPlaceholder")} value={query} onChange={value => { setQuery(value); setPage(1); }} className={styles.search} />
      <SelectField label={t("statusFilter")} value={status} onChange={value => { setStatus(String(value)); setPage(1); }} options={[{id:"", label:t("all")}, ...["pending", "processing", "succeeded", "failed", "canceled"].map(id => ({id,label:t(id)}))]} />
    </div>
    {loading && <LoadingState inline={rows.length > 0} label={t("loading")} />}
    {error && <div role="alert" className={styles.error}><p>{error}</p><Button variant="secondary" onPress={() => void load()}>{t("retry")}</Button></div>}
    {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
    {!loading && !error && rows.length === 0 && <EmptyState title={t("empty")} description={t("emptyHint")} />}
    <div className={styles.rows}>{rows.map(task => <TaskCenterRow key={task.id} task={task} isPending={busyId === task.id} isDisabled={busyId !== null}
      onCancel={() => setCancelId(task.id)} onRetry={() => void runAction(task.id,"retry")} onDetails={() => void runAction(task.id,"details")} onOpenObject={() => onOpenObject(task.objectRef)} />)}</div>
    <footer className={styles.pagination}><span>{t("page", {page,total:pageCount})}</span><div><IconButton aria-label={t("previousPage")} isDisabled={page <= 1 || loading} onPress={() => setPage(value => value - 1)}><ChevronLeft size={16} /></IconButton><IconButton aria-label={t("nextPage")} isDisabled={page >= pageCount || loading} onPress={() => setPage(value => value + 1)}><ChevronRight size={16} /></IconButton></div></footer>
    {selectedJob && <Dialog isOpen title={t("details")} closeLabel={t("close")} onOpenChange={open => {if (!open) setSelectedJob(null);}}>
      <div className={styles.events}>
        {selectedJob.job.items.map(item => <div key={item.id} className="border-b border-border-subtle pb-2 mb-2">
          <div className="flex flex-wrap gap-2"><strong>{item.kind}</strong><span>{t(item.status)}</span><code>{item.id.slice(0, 8)}</code></div>
          {item.retry_of && <small>{t("retryOf", { id: item.retry_of.slice(0, 8) })}</small>}
          {item.error_message && <p className="text-status-failed-fg">{item.error_code ? `${item.error_code} · ` : ""}{item.error_message}</p>}
        </div>)}
        {selectedJob.events.length ? selectedJob.events.map(event => <div key={event.id}><span>{event.from_status ? t(event.from_status) : "—"} → {t(event.to_status)}</span>{event.error_code && <code>{event.error_code}</code>}</div>) : <p>{t("noEvents")}</p>}
      </div>
    </Dialog>}
    {cancelId && <ActionDialog title={t("cancel")} description={t("confirmCancel")} confirmLabel={t("confirmCancelAction")} onClose={() => setCancelId(null)} onConfirm={async () => { await api.cancelTask(cancelId); await load(); }} />}
  </section>;
}
