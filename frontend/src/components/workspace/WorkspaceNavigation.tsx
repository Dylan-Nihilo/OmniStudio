"use client";

import { FileText, Film, Image, Layers, LayoutGrid, FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import styles from "./WorkspaceNavigation.module.css";

export type WorkspaceSection = "overview" | "projects" | "series" | "drafts";

export default function WorkspaceNavigation({ section }: { section: WorkspaceSection }) {
  const t = useTranslations("workspaceOverview");
  return (
    <nav className={styles.navigation} aria-label={t("title")}>
      <div className={styles.heading}><p>{t("eyebrow")}</p><h2>{t("title")}</h2></div>
      <div className={styles.links}>
        {([
          ["overview", "#/workspace", LayoutGrid],
          ["projects", "#/workspace/projects", FolderOpen],
          ["series", "#/workspace/series", Layers],
        ] as const).map(([id, href, Icon]) => (
          <a key={id} href={href} aria-current={section === id ? "page" : undefined}><Icon size={16} />{t(id)}</a>
        ))}
        <a href="#/library"><Image size={16} />{t("assets")}</a>
      </div>
      <div className={styles.shortcuts}>
        <p>{t("shortcuts")}</p>
        <a href="#/studio/editor"><FileText size={16} />{t("scripts")}</a>
        <a href="#/workspace/drafts" aria-current={section === "drafts" ? "page" : undefined}><Film size={16} />{t("drafts")}</a>
      </div>
    </nav>
  );
}
