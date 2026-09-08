"use client";

import { Home } from "lucide-react";
import { useTranslations } from "next-intl";
import SidebarSection from "@/components/layout/SidebarSection";
import styles from "@/components/layout/GlobalSidebar.module.css";

export type WorkspaceSection = "overview" | "projects" | "series" | "drafts";

export default function WorkspaceNavigation({ active, section }: { active: boolean; section: WorkspaceSection }) {
  const t = useTranslations("workspaceOverview");

  return (
    <SidebarSection active={active} navigationKey={section} label={t("title")} icon={<Home size={18} strokeWidth={1.8} aria-hidden="true" />}>
      <div className={styles.subnavItems}>
        {([
          ["overview", "#/workspace"],
          ["projects", "#/workspace/projects"],
          ["series", "#/workspace/series"],
        ] as const).map(([id, href]) => (
          <a key={id} href={href} aria-current={active && (section === id || section === "drafts" && id === "projects") ? "page" : undefined}>{t(id)}</a>
        ))}
      </div>
    </SidebarSection>
  );
}
