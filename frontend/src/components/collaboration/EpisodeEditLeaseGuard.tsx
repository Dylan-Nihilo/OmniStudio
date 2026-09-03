"use client";

import { useEffect } from "react";
import { Loader2, Lock } from "lucide-react";
import { useEditLeaseStore } from "@/store/editLeaseStore";

export default function EpisodeEditLeaseGuard({
  scriptId,
  children,
}: {
  scriptId: string;
  children: React.ReactNode;
}) {
  const status = useEditLeaseStore((state) => state.status);
  const holder = useEditLeaseStore((state) => state.holderDisplayName);
  const acquire = useEditLeaseStore((state) => state.acquire);
  const heartbeat = useEditLeaseStore((state) => state.heartbeat);
  const release = useEditLeaseStore((state) => state.release);

  useEffect(() => {
    void acquire(scriptId);
    return () => { void release(); };
  }, [acquire, release, scriptId]);

  useEffect(() => {
    if (status !== "editing") return;
    const timer = window.setInterval(() => { void heartbeat(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [heartbeat, status]);

  const readOnly = status !== "editing";
  return (
    <div className="relative h-full w-full">
      {status === "acquiring" && (
        <div className="absolute inset-x-0 top-3 z-[90] mx-auto flex w-fit items-center gap-2 rounded-full border border-glass-border bg-elevated px-4 py-2 text-sm text-text-secondary shadow-xl">
          <Loader2 size={15} className="animate-spin" />
          正在获取编辑权限
        </div>
      )}
      {readOnly && (
        <div className="absolute inset-x-0 top-3 z-[90] mx-auto flex w-fit items-center gap-2 rounded-full border border-amber-400/30 bg-elevated px-4 py-2 text-sm text-foreground shadow-xl">
          <Lock size={15} className="text-amber-400" />
          {status === "locked" ? `${holder} 正在编辑这一集，当前为只读` : "编辑权限已失效，当前内容未被覆盖"}
        </div>
      )}
      <div className={readOnly ? "pointer-events-none h-full select-text opacity-70" : "h-full"} aria-readonly={readOnly}>
        {children}
      </div>
    </div>
  );
}
