"use client";

import { useEffect, useState } from "react";
import { Copy, Plus, Users, X } from "lucide-react";
import { apiClient, AUTH_API_URL } from "@/lib/apiClient";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";

interface WorkspaceMember {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  role: "owner" | "member";
}

export default function WorkspaceControls() {
  const active = useAuthStore((state) => state.activeWorkspace);
  const workspaces = useAuthStore((state) => state.workspaces);
  const setActive = useAuthStore((state) => state.setActiveWorkspace);
  const createWorkspace = useAuthStore((state) => state.createWorkspace);
  const [membersOpen, setMembersOpen] = useState(false);

  const addWorkspace = async () => {
    const name = window.prompt("新 Workspace 名称");
    if (!name?.trim()) return;
    try {
      const workspace = await createWorkspace(name.trim());
      await setActive(workspace.id);
    } catch {
      toast.error("Workspace 创建失败");
    }
  };

  return (
    <>
      <div className="mb-2 border-b border-glass-border pb-2">
        <div className="flex items-center gap-1.5">
          <select
            aria-label="当前 Workspace"
            value={active?.id ?? ""}
            onChange={(event) => { void setActive(event.target.value); }}
            className="min-w-0 flex-1 rounded-lg border border-glass-border bg-surface px-2 py-1.5 text-xs text-foreground"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => { void addWorkspace(); }} aria-label="创建 Workspace" className="rounded-lg p-1.5 text-text-muted hover:bg-hover-bg hover:text-foreground">
            <Plus size={15} />
          </button>
          {active?.role === "owner" && (
            <button type="button" onClick={() => setMembersOpen(true)} aria-label="管理成员" className="rounded-lg p-1.5 text-text-muted hover:bg-hover-bg hover:text-foreground">
              <Users size={15} />
            </button>
          )}
        </div>
        <p className="mt-1 px-1 text-[0.6875rem] text-text-muted">
          {active?.role === "owner" ? "Owner" : "Member"}
        </p>
      </div>
      {membersOpen && active && (
        <MemberDialog workspaceId={active.id} workspaceName={active.name} onClose={() => setMembersOpen(false)} />
      )}
    </>
  );
}

function MemberDialog({ workspaceId, workspaceName, onClose }: { workspaceId: string; workspaceName: string; onClose: () => void }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [email, setEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");

  const loadMembers = async () => {
    try {
      const { data } = await apiClient.get<WorkspaceMember[]>(
        `${AUTH_API_URL}/auth/workspaces/${workspaceId}/members`,
      );
      setMembers(data);
    } catch {
      toast.error("成员列表加载失败");
    }
  };

  useEffect(() => { void loadMembers(); }, [workspaceId]);

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const { data } = await apiClient.post<{ token: string }>(
        `${AUTH_API_URL}/auth/workspaces/${workspaceId}/invitations`,
        { email },
      );
      const base = `${window.location.origin}${window.location.pathname}`;
      setInviteLink(`${base}#/invite/${encodeURIComponent(data.token)}`);
      setEmail("");
    } catch {
      toast.error("邀请生成失败");
    }
  };

  const remove = async (member: WorkspaceMember) => {
    if (!window.confirm(`移除 ${member.display_name || member.username}？`)) return;
    try {
      await apiClient.delete(`${AUTH_API_URL}/auth/workspaces/${workspaceId}/members/${member.id}`);
      await loadMembers();
    } catch {
      toast.error("成员移除失败");
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-overlay p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${workspaceName} 成员管理`} className="w-full max-w-lg rounded-2xl border border-glass-border bg-elevated p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">成员管理</h2>
            <p className="mt-1 text-sm text-text-muted">{workspaceName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-2 hover:bg-hover-bg"><X size={18} /></button>
        </div>
        <form onSubmit={invite} className="mt-5 flex gap-2">
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="成员邮箱" className="glass-input min-w-0 flex-1" />
          <button type="submit" className="rounded-lg bg-primary px-4 text-sm font-semibold text-white">生成邀请</button>
        </form>
        {inviteLink && (
          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="break-all text-xs text-text-secondary">{inviteLink}</p>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(inviteLink); toast.success("邀请链接已复制"); }} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <Copy size={13} />复制邀请链接
            </button>
          </div>
        )}
        <div className="mt-5 max-h-72 space-y-2 overflow-y-auto">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 rounded-lg border border-glass-border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{member.display_name || member.username}</p>
                <p className="truncate text-xs text-text-muted">{member.email}</p>
              </div>
              <span className="text-xs text-text-muted">{member.role === "owner" ? "Owner" : "Member"}</span>
              {member.role !== "owner" && <button type="button" onClick={() => { void remove(member); }} className="text-xs text-red-400">移除</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
