"use client";

import { useEffect, useState } from "react";
import GlobalSidebar, { type GlobalTab } from "./GlobalSidebar";
import OfflineBanner from "./OfflineBanner";
import BottomTabBar from "./BottomTabBar";
import { api } from "@/lib/api";

interface AppShellProps {
  activeTab: GlobalTab;
  onTabChange: (tab: GlobalTab) => void;
  children: React.ReactNode;
}

export default function AppShell({ activeTab, onTabChange, children }: AppShellProps) {
  const [taskBadge, setTaskBadge] = useState(0);

  useEffect(() => {
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
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <OfflineBanner />
      <div className="flex min-h-0 flex-1">
        <GlobalSidebar activeTab={activeTab} onTabChange={onTabChange} taskBadge={taskBadge} />
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
      <BottomTabBar activeTab={activeTab} onTabChange={onTabChange} taskBadge={taskBadge} />
    </div>
  );
}
