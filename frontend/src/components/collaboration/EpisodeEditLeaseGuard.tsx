"use client";

import { useCallback, useEffect, useRef } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@omnistudio/ui";
import { useEditLeaseStore } from "@/store/editLeaseStore";
import { useAuthStore } from "@/store/authStore";
import { useProjectStore } from "@/store/projectStore";

export default function EpisodeEditLeaseGuard({
  scriptId,
  children,
}: {
  scriptId: string;
  children: React.ReactNode;
}) {
  const status = useEditLeaseStore((state) => state.status);
  const holder = useEditLeaseStore((state) => state.holderDisplayName);
  const holderUserId = useEditLeaseStore((state) => state.holderUserId);
  const userId = useAuthStore((state) => state.user?.id);
  const viewer = useAuthStore((state) => state.activeWorkspace?.role === "viewer");
  const acquire = useEditLeaseStore((state) => state.acquire);
  const heartbeat = useEditLeaseStore((state) => state.heartbeat);
  const release = useEditLeaseStore((state) => state.release);
  const checking = useRef(false);

  useEffect(() => {
    if (viewer) return;
    const project = useProjectStore.getState().currentProject;
    void acquire(scriptId, project?.id === scriptId ? project._revision : undefined).catch(() => {});
    return () => { void release(); };
  }, [acquire, release, scriptId, viewer]);

  const check = useCallback(async () => {
    const lease = useEditLeaseStore.getState();
    if (viewer || checking.current || lease.scriptId !== scriptId || lease.status === "acquiring") return;
    checking.current = true;
    try {
      if (lease.status === "editing") await heartbeat();
      const current = useEditLeaseStore.getState();
      if (current.scriptId === scriptId && (current.status === "locked" || current.status === "lost")) {
        await acquire(scriptId);
      }
    } catch {
      // Keep the local editor mounted; retry after reconnecting or on the next check.
    } finally {
      checking.current = false;
    }
  }, [acquire, heartbeat, scriptId, viewer]);

  useEffect(() => {
    if (viewer) return;
    const recheck = () => { void check(); };
    const visible = () => { if (document.visibilityState === "visible") recheck(); };
    const timer = window.setInterval(recheck, 20_000);
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [check, viewer]);

  useEffect(() => {
    if (viewer || status !== "locked") return;
    const timer = window.setInterval(() => {
      void acquire(scriptId).catch(() => { /* The store exposes connection loss. */ });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [acquire, scriptId, status, viewer]);

  const readOnly = viewer || status !== "editing";
  const acquiring = status === "acquiring" || status === "idle";
  // Only ever offered for a lease this user already holds elsewhere. Someone else's unsaved
  // edits are not ours to discard, and the automatic re-check never takes over — that is
  // what stops two tabs from stealing the lease back and forth.
  const ownOtherWindow = status === "locked" && !!userId && holderUserId === userId;
  const message = viewer ? "当前账号只能查看这一集" : acquiring ? "正在检查编辑状态"
    : status === "locked"
      ? ownOtherWindow
        ? "你的另一个窗口正在编辑这一集，当前只读。可以在本窗口继续编辑，那个窗口会转为只读。"
        : `${holder} 正在编辑这一集，当前只读。对方结束后会自动恢复。`
      : "编辑连接已中断，正在自动恢复。未保存内容仍保留在本页。";
  return (
    <div className="relative h-full w-full">
      {readOnly && (
        <div role="status" className="absolute inset-x-3 top-3 z-[90] mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-2xl border border-amber-400/30 bg-elevated px-4 py-2 text-sm text-foreground shadow-xl">
          {acquiring && !viewer ? <Loader2 size={15} className="shrink-0 animate-spin" /> : <Lock size={15} className="shrink-0 text-amber-400" />}
          <span className="min-w-0 flex-1 break-words">{message}</span>
          {ownOtherWindow && <Button variant="secondary" onPress={() => { void acquire(scriptId, undefined, true).catch(() => {}); }}>在本窗口继续编辑</Button>}
          {!viewer && !acquiring && <Button variant="quiet" onPress={() => { void check(); }}>重新检查</Button>}
        </div>
      )}
      <div className={readOnly ? "pointer-events-none h-full select-text opacity-70" : "h-full"} aria-readonly={readOnly}>
        {children}
      </div>
    </div>
  );
}
