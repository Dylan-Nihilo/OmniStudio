"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { apiClient, AUTH_API_URL } from "@/lib/apiClient";
import { useAuthStore, type WorkspaceSummary } from "@/store/authStore";

export default function InvitationAcceptPage({ token }: { token: string }) {
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const setActiveWorkspace = useAuthStore((state) => state.setActiveWorkspace);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const accept = async () => {
    setPending(true);
    setError("");
    try {
      const { data } = await apiClient.post<WorkspaceSummary>(
        `${AUTH_API_URL}/auth/invitations/accept`,
        { token },
      );
      await refreshUser();
      await setActiveWorkspace(data.id);
    } catch {
      setError("邀请无效、已过期，或当前账号邮箱与邀请不一致");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-7 text-center shadow-2xl shadow-black/30">
      <h1 className="font-display text-2xl font-semibold text-foreground">加入团队 Workspace</h1>
      <p className="mt-2 text-sm text-text-secondary">接受后可在左侧随时切换个人与团队空间。</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
      <button type="button" onClick={() => { void accept(); }} disabled={pending} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {pending && <Loader2 size={15} className="animate-spin" />}
        接受邀请
      </button>
    </div>
  );
}
