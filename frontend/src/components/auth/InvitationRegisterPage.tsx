"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

export default function InvitationRegisterPage({ token }: { token: string }) {
  const registerInvitation = useAuthStore((state) => state.registerInvitation);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await registerInvitation({ token, username, email, password });
      window.location.hash = "#/workspace";
    } catch {
      setError("邀请无效、已过期，或邮箱与邀请不一致");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass-panel rounded-2xl p-7 shadow-2xl shadow-black/30">
      <h1 className="font-display text-2xl font-semibold text-foreground">加入团队</h1>
      <p className="mt-2 text-sm text-text-secondary">创建账号后，你会同时拥有个人 Workspace 和受邀团队空间。</p>
      <div className="mt-6 space-y-4">
        <label className="block text-sm text-text-secondary">
          用户名
          <input className="glass-input mt-1.5 w-full" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} />
        </label>
        <label className="block text-sm text-text-secondary">
          受邀邮箱
          <input className="glass-input mt-1.5 w-full" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="block text-sm text-text-secondary">
          密码
          <input className="glass-input mt-1.5 w-full" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </label>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={pending} className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {pending && <Loader2 size={15} className="animate-spin" />}
        接受邀请并创建账号
      </button>
    </form>
  );
}
