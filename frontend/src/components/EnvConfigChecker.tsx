"use client";

import { useState, useEffect } from "react";
import EnvConfigDialog from "@/components/project/EnvConfigDialog";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function EnvConfigChecker() {
  const userId = useAuthStore(state => state.user?.id);
  const workspace = useAuthStore(state => state.activeWorkspace);
  const bootstrapping = useAuthStore(state => state.bootstrapping);
  const scope = !bootstrapping && userId && workspace?.role === "owner"
    ? JSON.stringify([userId, workspace.id]) : null;
  const [promptScope, setPromptScope] = useState<string | null>(null);

  useEffect(() => {
    setPromptScope(null);
    if (!scope) return;
    let cancelled = false;
    void api.getEnvConfig().then(config => {
      // Ask the backend rather than picking a variable to check. Which credential matters
      // is not knowable from here — the text tiers each carry their own key — and guessing
      // OPENAI_API_KEY put this dialog in front of root on every page load while all three
      // tiers were answering. The old guess stays only for a backend too old to say.
      const configured = config.llm_configured
        ?? (() => {
          const key = config.LLM_PROVIDER === "openai" ? "OPENAI_API_KEY" : "DASHSCOPE_API_KEY";
          return config.secrets_configured?.[key] ?? Boolean(config[key]?.trim());
        })();
      if (!cancelled && !configured) setPromptScope(scope);
    }).catch(() => {
      // A failed or forbidden read does not establish that credentials are missing.
      // Authentication recovery and explicit Settings retries handle these errors.
    });
    return () => { cancelled = true; };
  }, [scope]);

  return <EnvConfigDialog key={scope}
    isOpen={scope !== null && promptScope === scope}
    onClose={() => setPromptScope(null)} isRequired />;
}
