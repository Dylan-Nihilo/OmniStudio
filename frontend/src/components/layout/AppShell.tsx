"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { PageTransition } from "@omnistudio/ui";
import GlobalSidebar, { type GlobalTab } from "./GlobalSidebar";
import OfflineBanner from "./OfflineBanner";
import BottomTabBar from "./BottomTabBar";
import type { WorkspaceSection } from "@/components/workspace/WorkspaceNavigation";

interface AppShellProps {
  activeTab: GlobalTab;
  onTabChange: (tab: GlobalTab) => void;
  children: React.ReactNode;
  context?: React.ReactNode;
  transitionKey?: string;
  workspaceSection?: WorkspaceSection;
}

export default function AppShell({ activeTab, onTabChange, children, context, workspaceSection, transitionKey = activeTab }: AppShellProps) {
  const [taskBadge, setTaskBadge] = useState(0);

  const workspaceId = useAuthStore(state => state.activeWorkspace?.id);
  useEffect(() => {
    setTaskBadge(0);
    let active = true;
    const refreshBadge = async () => {
      try {
        const summary = await api.getTaskSummary();
        if (active) setTaskBadge(summary.running + summary.failed);
      } catch {
        // Navigation stays usable when task summary is temporarily unavailable.
      }
    };
    void refreshBadge();
    const timer = window.setInterval(refreshBadge, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspaceId]);

  return (
    <div className="flex h-full w-full flex-col">
      <OfflineBanner />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <GlobalSidebar activeTab={activeTab} onTabChange={onTabChange} context={context} workspaceSection={workspaceSection} taskBadge={taskBadge} />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><PageTransition transitionKey={transitionKey}>{children}</PageTransition></div>
      </div>
      <BottomTabBar activeTab={activeTab} onTabChange={onTabChange} taskBadge={taskBadge} />
    </div>
  );
}
