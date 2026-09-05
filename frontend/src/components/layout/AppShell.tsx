"use client";

import GlobalSidebar, { type GlobalTab } from "./GlobalSidebar";
import OfflineBanner from "./OfflineBanner";
import BottomTabBar from "./BottomTabBar";

interface AppShellProps {
  activeTab: GlobalTab;
  onTabChange: (tab: GlobalTab) => void;
  children: React.ReactNode;
  context?: React.ReactNode;
}

export default function AppShell({ activeTab, onTabChange, children, context }: AppShellProps) {
  return (
    <div className="flex h-full w-full flex-col">
      <OfflineBanner />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <GlobalSidebar activeTab={activeTab} onTabChange={onTabChange} context={context} />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>
      <BottomTabBar activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  );
}
