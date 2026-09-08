"use client";

import { useTranslations } from "next-intl";
import clsx from "clsx";
import { GLOBAL_NAV_ITEMS, type GlobalTab } from "./GlobalSidebar";

/**
 * Mobile global navigation — a bottom tab bar shown only below md.
 * At md+ the GlobalSidebar (hidden md:flex) takes over. Mirrors the sidebar's
 * nav model + hash routing so the two never drift (single source: GLOBAL_NAV_ITEMS).
 */
export default function BottomTabBar({
  activeTab,
  onTabChange,
  taskBadge,
}: {
  activeTab: GlobalTab;
  onTabChange: (tab: GlobalTab) => void;
  taskBadge?: number;
}) {
  const t = useTranslations("nav");
  return (
    <nav
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      className="md:hidden flex-shrink-0 flex items-stretch border-t border-glass-border bg-surface"
      aria-label={t("mainNavAria")}
    >
      {GLOBAL_NAV_ITEMS.map(({ id, icon: Icon, hash }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              onTabChange(id);
              window.location.hash = hash;
            }}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "relative min-w-0 flex-1 flex flex-col items-center justify-center gap-1 min-h-[56px] py-2 transition-colors",
              active ? "text-primary" : "text-text-muted hover:text-foreground"
            )}
          >
            <span className="relative"><Icon size={19} strokeWidth={1.8} />{id === "tasks" && !!taskBadge && <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-status-failed-fg px-1 text-[0.5625rem] leading-4 text-white">{taskBadge > 9 ? "9+" : taskBadge}</span>}</span>
            <span className="max-w-full truncate text-[0.625rem] font-medium leading-none">{t(id)}</span>
          </button>
        );
      })}
    </nav>
  );
}
