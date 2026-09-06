"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, Home } from "lucide-react";
import { useTranslations } from "next-intl";
import styles from "./WorkspaceNavigation.module.css";

export type WorkspaceSection = "overview" | "projects" | "series" | "drafts";

export default function WorkspaceNavigation({ active, section }: { active: boolean; section: WorkspaceSection }) {
  const t = useTranslations("workspaceOverview");
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (menuRef.current) menuRef.current.open = active;
  }, [active, section]);

  return (
    <details ref={menuRef} className={styles.navigation} data-active={active}>
      <summary className={styles.summary}>
        <Home size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>{t("title")}</span>
        <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.links}>
        {([
          ["overview", "#/workspace"],
          ["projects", "#/workspace/projects"],
          ["series", "#/workspace/series"],
        ] as const).map(([id, href]) => (
          <a key={id} href={href} aria-current={active && (section === id || section === "drafts" && id === "projects") ? "page" : undefined}>{t(id)}</a>
        ))}
      </div>
    </details>
  );
}
