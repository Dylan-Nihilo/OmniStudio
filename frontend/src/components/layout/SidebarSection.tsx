"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./GlobalSidebar.module.css";

export default function SidebarSection({ active, label, icon, children, navigationKey }: {
  active: boolean; label: string; icon: ReactNode; children: ReactNode; navigationKey?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!menu.current) return;
    menu.current.open = active;
    if (active && window.matchMedia("(min-width: 768px)").matches) {
      menu.current.querySelector('[aria-current="page"], [aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
    }
  }, [active, navigationKey]);
  return <details ref={menu} className={styles.section} data-active={active}>
    <summary className={`${styles.navButton} ${styles.sectionToggle}`}>
      {icon}<span>{label}</span><ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
    </summary>
    <div className={styles.sectionContent}>{children}</div>
  </details>;
}
