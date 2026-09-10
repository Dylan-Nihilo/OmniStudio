"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import AuthThemeMenu from "./AuthThemeMenu";
import heroArt from "../../../public/auth/hero-night-signal.png";
import brandMark from "../../../public/auth/omnistudio-mark.png";
import styles from "./LoginPage.module.css";

export default function AuthLayout({ children, title, subtitle, titleId }: {
  children: ReactNode;
  title: string;
  subtitle: string;
  titleId: string;
}) {
  const t = useTranslations("auth");

  return (
    <main data-testid="auth-surface" className={styles.page}>
      <header className={styles.header}>
        <div data-testid="auth-brand" className={styles.brand}>
          <Image src={brandMark} alt="Omni Studio" width={30} height={30} style={{ width: 30, height: 30 }} />
          <span>OMNI STUDIO</span>
        </div>
        <span className={styles.headerNote}>{t("panelEyebrow")}</span>
        <AuthThemeMenu />
      </header>

      <div className={styles.layout}>
        <aside className={styles.story} aria-label={t("heroEyebrow")}>
          <div className={styles.frames} aria-hidden="true">
            <div className={styles.mainFrame}>
              <Image src={heroArt} alt="" fill priority sizes="(min-width: 960px) 58vw, 100vw" />
            </div>
            <div className={styles.detailFrame}>
              <Image src={heroArt} alt="" fill sizes="(min-width: 960px) 24vw, 40vw" />
            </div>
            <span className={styles.frameLabel}>OMNI / MOTION COMICS</span>
          </div>
          <div className={styles.storyCopy}>
            <p className={styles.eyebrow}>{t("heroEyebrow")}</p>
            <h2><span>{t("heroTitleA")}</span><strong>{t("heroTitleB")}</strong></h2>
            <p className={styles.storyNote}>{t("heroNote")}</p>
          </div>
        </aside>

        <section data-testid="auth-panel" className={styles.panel} aria-labelledby={titleId}>
          <div className={styles.panelHeading}>
            <span className={styles.chapter} aria-hidden="true">LET’S CREATE</span>
            <h1 id={titleId}>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {children}
        </section>
      </div>
      <footer className={styles.footer}>
        <span>OMNI STUDIO</span>
        <span>STORIES, RENDERED ALIVE.</span>
      </footer>
    </main>
  );
}
