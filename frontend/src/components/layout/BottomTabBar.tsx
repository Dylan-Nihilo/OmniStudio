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
}: {
  activeTab: GlobalTab;
  onTabChange: (tab: GlobalTab) => void;
}) {
  const t = useTranslations("nav");
  return (
    <nav
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      className="md:hidden flex-shrink-0 flex items-stretch border-t border-glass-border bg-surface/80 backdrop-blur-xl"
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
              "flex-1 flex flex-col items-center justify-center gap-1 min-h-[56px] py-2 transition-colors",
              active ? "text-primary" : "text-text-muted hover:text-foreground"
            )}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span className="text-[0.625rem] font-medium leading-none">{t(id)}</span>
          </button>
        );
      })}
    </nav>
  );
}
