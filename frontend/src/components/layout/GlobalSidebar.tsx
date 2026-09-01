"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronUp,
  FileText,
  KeyRound,
  Layers,
  LayoutGrid,
  LogOut,
  Settings,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import OmniStudioBranding from "./OmniStudioBranding";
import { isTauri } from "@/lib/transport";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";
import ChangePasswordDialog from "@/components/auth/ChangePasswordDialog";

export type GlobalTab = "workspace" | "library" | "editor" | "playground" | "settings";

interface GlobalSidebarProps {
  activeTab: GlobalTab;
  onTabChange: (tab: GlobalTab) => void;
}

export const GLOBAL_NAV_ITEMS: { id: GlobalTab; icon: typeof LayoutGrid; hash: string }[] = [
  { id: "workspace", icon: LayoutGrid, hash: "#/" },
  { id: "library", icon: Layers, hash: "#/library" },
  { id: "editor", icon: FileText, hash: "#/studio/editor" },
  { id: "playground", icon: Wand2, hash: "#/playground" },
  { id: "settings", icon: Settings, hash: "#/settings" },
];

const APP_VERSION = "v0.2.0";

export const getUserMenuLayerClasses = () => "relative z-30";
export const getUserMenuPopoverClasses = () =>
  "absolute bottom-full left-0 right-0 z-[70] isolate mb-2 overflow-hidden rounded-xl border border-glass-border bg-elevated p-1.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.92)] ring-1 ring-black/40";
export const getLogoutButtonClasses = () =>
  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-status-failed-fg transition hover:bg-status-failed-bg hover:text-status-failed-fg";

function NavButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof LayoutGrid;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        active
          ? "bg-primary/10 font-semibold text-foreground"
          : "font-medium text-text-secondary hover:bg-hover-bg hover:text-foreground",
      )}
    >
      {active && <span className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-r bg-primary" />}
      <Icon
        size={18}
        strokeWidth={1.8}
        className={clsx(
          "flex-shrink-0 transition-colors",
          active ? "text-primary" : "text-text-muted group-hover:text-foreground",
        )}
      />
      <span className="text-base">{label}</span>
    </button>
  );
}

export default function GlobalSidebar({ activeTab, onTabChange }: GlobalSidebarProps) {
  const t = useTranslations("nav");
  const ta = useTranslations("auth");
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [menuOpen, setMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [menuOpen]);

  const handleNav = (id: GlobalTab, hash: string) => {
    onTabChange(id);
    window.location.hash = hash;
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    try {
      await logout();
    } catch {
      toast.warning(ta("logoutUnconfirmed"));
    }
  };

  const displayName = user?.display_name || user?.username || "Omni Studio";
  const avatarLetter = displayName.trim().charAt(0).toUpperCase() || "M";

  return (
    <>
      <aside
        className="relative z-40 hidden h-full w-52 flex-shrink-0 flex-col border-r border-glass-border bg-surface/60 backdrop-blur-xl md:flex"
        data-tauri-drag-region
      >
        {isTauri() && <div className="tauri-titlebar-inset" />}
        <button
          type="button"
          onClick={() => handleNav("workspace", "#/")}
          aria-label={t("workspaceAria")}
          className="border-b border-glass-border px-4 pb-3.5 pt-4 text-left transition-opacity hover:opacity-90"
        >
          <OmniStudioBranding size="sm" showSlogan={false} />
          <p className="atelier-display mt-1.5 font-display text-[0.6875rem] italic leading-snug tracking-wide text-text-muted">
            Stories, Rendered Alive.
          </p>
        </button>

        <nav className="flex flex-1 flex-col gap-0.5 p-2.5" aria-label={t("mainNavAria")}>
          {GLOBAL_NAV_ITEMS.slice(0, 4).map((item) => (
            <NavButton
              key={item.id}
              active={activeTab === item.id}
              label={t(item.id)}
              icon={item.icon}
              onClick={() => handleNav(item.id, item.hash)}
            />
          ))}
        </nav>

        <div className="border-t border-glass-border p-2.5">
          <NavButton
            active={activeTab === "settings"}
            label={t("settings")}
            icon={Settings}
            onClick={() => handleNav("settings", "#/settings")}
          />

          <div ref={menuRef} className={clsx("mt-2 border-t border-glass-border pt-2", getUserMenuLayerClasses())}>
            {menuOpen && (
              <div className={getUserMenuPopoverClasses()}>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setChangePasswordOpen(true); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition hover:bg-hover-bg"
                >
                  <KeyRound size={15} />
                  {ta("changePassword")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className={getLogoutButtonClasses()}
                >
                  <LogOut size={15} />
                  {ta("logout")}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-hover-bg"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-pink-500 text-sm font-bold text-white shadow-md shadow-primary/20">
                {avatarLetter}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{displayName}</span>
                <span className="block truncate text-[0.6875rem] text-text-muted">@{user?.username}</span>
              </span>
              <ChevronUp size={15} className={clsx("text-text-muted transition-transform", menuOpen && "rotate-180")} />
            </button>
          </div>

          <div className="px-3 pt-2 font-mono text-[0.6875rem] tracking-wide text-text-muted">{APP_VERSION}</div>
        </div>
      </aside>

      <ChangePasswordDialog isOpen={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </>
  );
}
