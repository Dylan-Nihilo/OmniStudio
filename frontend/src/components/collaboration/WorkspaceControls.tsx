"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Copy, Plus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Dialog, EmptyState, IconButton, LoadingState, SelectField, TextField } from "@omnistudio/ui";
import { apiClient, AUTH_API_URL } from "@/lib/apiClient";
import { useAuthStore, type WorkspaceRole } from "@/store/authStore";
import { toast } from "@/store/toastStore";

interface WorkspaceMember {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  role: WorkspaceRole;
}

export default function WorkspaceControls({ children }: { children?: (controls: ReactNode) => ReactNode }) {
  const t = useTranslations("workspaceControls");
  const tc = useTranslations("common");
  const active = useAuthStore((state) => state.activeWorkspace);
  const workspaces = useAuthStore((state) => state.workspaces);
  const setActive = useAuthStore((state) => state.setActiveWorkspace);
  const createWorkspace = useAuthStore((state) => state.createWorkspace);
  const [membersOpen, setMembersOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [createdId, setCreatedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();

  const switchWorkspace = async (id: string) => {
    if (busy || id === active?.id) return;
    setBusy(true);
    setError("");
    try { await setActive(id); }
    catch { setError(t("switchFailed")); }
    finally { setBusy(false); }
  };

  const addWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    let id = createdId;
    try {
      if (!id) {
        const workspace = await createWorkspace(name.trim());
        id = workspace.id;
        setCreatedId(id);
      }
      await setActive(id);
      setCreateOpen(false);
    } catch { setError(t(id ? "switchCreatedFailed" : "createFailed")); }
    finally { setBusy(false); }
  };

  const controls = (
      <div className="mb-2 grid gap-2 border-b border-glass-border pb-3">
        <SelectField label={t("currentWorkspace")} value={active?.id ?? null} onChange={(value) => { if (typeof value === "string") void switchWorkspace(value); }}
          options={workspaces.map(workspace => ({ id: workspace.id, label: workspace.name }))} isDisabled={busy || membersOpen || createOpen} />
        <div className="flex items-center gap-1">
          <span className="mr-auto text-xs text-text-muted">{t(active?.role ?? "member")}</span>
          <IconButton aria-label={t("createWorkspace")} isDisabled={busy} onPress={() => { setName(""); setCreatedId(undefined); setError(""); setCreateOpen(true); }}><Plus size={16} /></IconButton>
          {active?.role === "owner" && <IconButton aria-label={t("manageMembers")} isDisabled={busy} onPress={() => setMembersOpen(true)}><Users size={16} /></IconButton>}
        </div>
        {busy && !createOpen && <LoadingState inline label={t("switching")} />}
        {error && !createOpen && <p role="alert" className="text-xs text-status-failed-fg">{error}</p>}
      </div>
  );

  return (
    <>
      {children ? children(controls) : controls}
      <Dialog isOpen={createOpen} onOpenChange={(open) => { if (!busy) setCreateOpen(open); }} isDismissable={!busy} title={t("createWorkspace")} closeLabel={tc("close")}
        footer={<><Button variant="secondary" isDisabled={busy} onPress={() => setCreateOpen(false)}>{tc("cancel")}</Button><Button type="submit" form={formId} isPending={busy} isDisabled={!name.trim()}>{tc("create")}</Button></>}>
        <form id={formId} onSubmit={addWorkspace} className="grid gap-4">
          <TextField label={t("workspaceName")} value={name} onChange={setName} isRequired isDisabled={busy || Boolean(createdId)} autoFocus />
          {error && <p role="alert" className="text-sm text-status-failed-fg">{error}</p>}
        </form>
      </Dialog>
      {membersOpen && active && <MemberDialog key={active.id} workspaceId={active.id} workspaceName={active.name} onClose={() => setMembersOpen(false)} />}
    </>
  );
}

function MemberDialog({ workspaceId, workspaceName, onClose }: { workspaceId: string; workspaceName: string; onClose: () => void }) {
  const t = useTranslations("workspaceControls");
  const tc = useTranslations("common");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [email, setEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [accessRole, setAccessRole] = useState<Exclude<WorkspaceRole, "owner">>("member");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);

  const updateRole = async (member: WorkspaceMember, value: string | null) => {
    if (busy || member.role === "owner" || (value !== "member" && value !== "editor" && value !== "viewer")) return;
    const previous = member.role;
    setBusy(true);
    setError("");
    setMembers(current => current.map(item => item.id === member.id ? { ...item, role: value } : item));
    try {
      await apiClient.patch(`${AUTH_API_URL}/auth/workspaces/${workspaceId}/members/${member.id}`, { access_role: value });
    } catch {
      setMembers(current => current.map(item => item.id === member.id ? { ...item, role: previous } : item));
      setError(t("roleUpdateFailed"));
    } finally { setBusy(false); }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    apiClient.get<WorkspaceMember[]>(`${AUTH_API_URL}/auth/workspaces/${workspaceId}/members`)
      .then(({ data }) => { if (!cancelled) setMembers(data); })
      .catch(() => { if (!cancelled) setLoadFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, reload]);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await apiClient.post<{ token: string }>(`${AUTH_API_URL}/auth/workspaces/${workspaceId}/invitations`, { email: email.trim(), access_role: accessRole });
      setInviteLink(`${window.location.origin}${window.location.pathname}#/invite/${encodeURIComponent(data.token)}`);
      setEmail("");
    } catch { setError(t("inviteFailed")); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (busy || !removing) return;
    setBusy(true);
    setError("");
    try {
      await apiClient.delete(`${AUTH_API_URL}/auth/workspaces/${workspaceId}/members/${removing.id}`);
      setMembers(current => current.filter(member => member.id !== removing.id));
      setRemoving(null);
    } catch { setError(t("removeFailed")); }
    finally { setBusy(false); }
  };

  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(inviteLink); toast.success(t("inviteCopied")); }
    catch { setError(t("copyFailed")); }
  };

  return <>
    <Dialog isOpen title={t("manageMembers")} closeLabel={tc("close")} isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <div className="grid gap-4">
        <p className="text-sm text-text-muted">{workspaceName}</p>
        <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
          <TextField label={t("memberEmail")} type="email" value={email} onChange={setEmail} isRequired isDisabled={busy} className="min-w-40 flex-1" />
          <SelectField label={t("role")} value={accessRole} onChange={(value) => { if (value === "member" || value === "editor" || value === "viewer") setAccessRole(value); }} options={["member", "editor", "viewer"].map(role => ({ id: role, label: t(role) }))} isDisabled={busy} />
          <Button type="submit" isPending={busy && !removing}>{t("generateInvite")}</Button>
        </form>
        {inviteLink && <div className="grid gap-2 rounded-lg border border-glass-border p-3">
          <p className="break-all text-xs text-text-secondary">{inviteLink}</p>
          <Button variant="quiet" onPress={() => void copyInvite()}><Copy size={14} />{t("copyInvite")}</Button>
        </div>}
        {error && !removing && <p role="alert" className="text-sm text-status-failed-fg">{error}</p>}
        {loading ? <LoadingState label={tc("loading")} /> : loadFailed ? <div role="alert" className="grid gap-2 text-sm">
          <p>{t("membersFailed")}</p><Button variant="secondary" onPress={() => setReload(value => value + 1)}>{t("retry")}</Button>
        </div> : members.length === 0 ? <EmptyState title={t("noMembers")} /> : <ul className="divide-y divide-glass-border">
          {members.map(member => <li key={member.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.display_name || member.username}</p><p className="truncate text-xs text-text-muted">{member.email}</p></div>
            {member.role === "owner" ? <span className="text-xs text-text-muted">{t(member.role)}</span> : <SelectField aria-label={`${t("role")} ${member.username}`} label={t("role")} value={member.role} onChange={(value) => void updateRole(member, typeof value === "string" ? value : null)} options={["member", "editor", "viewer"].map(role => ({ id: role, label: t(role) }))} isDisabled={busy} />}
            {member.role !== "owner" && <Button variant="quiet" isDisabled={busy} onPress={() => { setError(""); setRemoving(member); }}>{t("removeMember")}</Button>}
          </li>)}
        </ul>}
      </div>
    </Dialog>
    <Dialog isOpen={Boolean(removing)} title={t("removeMember")} closeLabel={tc("close")} isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) { setRemoving(null); setError(""); } }}
      footer={<><Button variant="secondary" isDisabled={busy} onPress={() => { setRemoving(null); setError(""); }}>{tc("cancel")}</Button><Button variant="danger" isPending={busy} onPress={() => void remove()}>{tc("confirm")}</Button></>}>
      <p>{t("removeConfirm", { name: removing?.display_name || removing?.username || "" })}</p>
      {error && <p role="alert" className="mt-3 text-sm text-status-failed-fg">{error}</p>}
    </Dialog>
  </>;
}
