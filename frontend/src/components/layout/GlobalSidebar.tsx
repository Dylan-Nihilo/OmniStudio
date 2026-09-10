"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronUp,
  Home,
  Film,
  Image as ImageIcon,
  Play,
  KeyRound,
  LayoutGrid,
  ListTodo,
  LogOut,
  Settings,
} from "lucide-react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { Popover } from "@heroui/react";
import { Button } from "@omnistudio/ui";
import Image from "next/image";
import brandMark from "../../../public/auth/omnistudio-mark.png";
import styles from "./GlobalSidebar.module.css";
import { isTauri } from "@/lib/transport";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";
import ChangePasswordDialog from "@/components/auth/ChangePasswordDialog";
import WorkspaceControls from "@/components/collaboration/WorkspaceControls";
import WorkspaceNavigation, { type WorkspaceSection } from "@/components/workspace/WorkspaceNavigation";
import SidebarSection from "./SidebarSection";

export type GlobalTab = "workspace" | "library" | "editor" | "playground" | "tasks" | "settings";

interface GlobalSidebarProps {
  activeTab: GlobalTab;
  onTabChange: (tab: GlobalTab) => void;
  taskBadge?: number;
  context?: ReactNode;
  workspaceSection?: WorkspaceSection;
}

export const GLOBAL_NAV_ITEMS: { id: GlobalTab; icon: typeof LayoutGrid; hash: string }[] = [
  { id: "workspace", icon: Home, hash: "#/workspace" },
  { id: "editor", icon: Film, hash: "#/studio/editor" },
  { id: "library", icon: ImageIcon, hash: "#/library" },
  { id: "playground", icon: Play, hash: "#/playground" },
  { id: "tasks", icon: ListTodo, hash: "#/tasks" },
  { id: "settings", icon: Settings, hash: "#/settings" },
];

export const getUserMenuLayerClasses = () => "relative z-30";
export const getUserMenuPopoverClasses = () =>
  "isolate rounded-xl border border-glass-border bg-elevated shadow-lg";
export const getSidebarBrandImageStyle = () => ({ width: 24, height: "auto" as const });
export const getLogoutButtonClasses = () =>
  "flex w-full items-center justify-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-status-failed-fg transition hover:bg-status-failed-bg hover:text-status-failed-fg";

function NavButton({
  active,
  label,
  icon: Icon,
  onClick,
  badge,
}: {
  active: boolean;
  label: string;
  icon: typeof LayoutGrid;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={styles.navButton}
    >

      <Icon
        size={18}
        strokeWidth={1.8}
        className={clsx(
          "flex-shrink-0 transition-colors",
          active ? "text-primary" : "text-text-muted group-hover:text-foreground",
        )}
      />
      <span>{label}</span>
      {!!badge && <span className={styles.subnavCount}>{badge > 99 ? "99+" : badge}</span>}
    </button>
  );
}

export default function GlobalSidebar({ activeTab, onTabChange, context, taskBadge, workspaceSection = "overview" }: GlobalSidebarProps) {
  const t = useTranslations("nav");
  const ta = useTranslations("auth");
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [menuOpen, setMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

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

  const account = (
    <div className={clsx(styles.account, getUserMenuLayerClasses())}>
      <WorkspaceControls>{controls => <Popover isOpen={menuOpen} onOpenChange={setMenuOpen}>
        <Button variant="quiet" aria-label={displayName} className={styles.accountButton}>
          <span className={styles.avatar}>{avatarLetter}</span>
          <span className={styles.identity}>
            <strong>{displayName}</strong><span>@{user?.username}</span>
          </span>
          <ChevronUp size={15} className={styles.accountChevron} />
        </Button>
        <Popover.Content placement="top start" offset={8} style={{ zIndex: 50 }} className={clsx(styles.popover, getUserMenuPopoverClasses())}>
          <Popover.Dialog aria-label={displayName}>
            {controls}
            <Button variant="quiet" onPress={() => { setMenuOpen(false); setChangePasswordOpen(true); }} className={styles.accountAction}>
              <KeyRound size={15} />{ta("changePassword")}
            </Button>
            <Button variant="quiet" onPress={() => void handleLogout()} className={getLogoutButtonClasses()}>
              <LogOut size={15} />{ta("logout")}
            </Button>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>}</WorkspaceControls>
    </div>
  );

  return (
    <>
      <aside className={styles.rail} data-tauri-drag-region data-app-sidebar>
        {isTauri() && <div className="tauri-titlebar-inset" />}
        <button type="button" onClick={() => handleNav("workspace", "#/workspace")} aria-label={t("workspaceAria")} className={styles.brand}>
          <Image src={brandMark} alt="" width={24} height={24} priority style={getSidebarBrandImageStyle()} /><span>Omni Studio</span>
        </button>
        <div className={styles.navigationBody}><nav className={styles.railNav} aria-label={t("mainNavAria")}>
          <WorkspaceNavigation active={activeTab === "workspace"} section={workspaceSection} />
          {GLOBAL_NAV_ITEMS.filter(item => item.id !== "workspace" && item.id !== "settings").map((item) => (
            activeTab === item.id && context
              ? <SidebarSection key={item.id} active label={t(item.id)} icon={<item.icon size={18} strokeWidth={1.8} aria-hidden="true" />}>{context}</SidebarSection>
              : <NavButton key={item.id} active={activeTab === item.id} label={t(item.id)} icon={item.icon} onClick={() => handleNav(item.id, item.hash)} badge={item.id === "tasks" ? taskBadge : undefined} />
          ))}
        </nav>
        </div>
        <div className={styles.railBottom}>
          <NavButton active={activeTab === "settings"} label={t("settings")} icon={Settings} onClick={() => handleNav("settings", "#/settings")} />
          {account}
        </div>
      </aside>
      <ChangePasswordDialog isOpen={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </>
  );
}
