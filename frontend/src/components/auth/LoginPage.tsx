"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { consumeReturnHash, getApiErrorCode, getApiErrorStatus } from "@/lib/apiClient";
import { useAuthStore } from "@/store/authStore";
import { Button, Checkbox, TextField, PasswordField } from "@omnistudio/ui";
import AuthThemeMenu from "./AuthThemeMenu";
import Image from "next/image";
import heroArt from "../../../public/auth/hero-night-signal.png";
import brandMark from "../../../public/auth/omnistudio-mark.png";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const t = useTranslations("auth");
  const login = useAuthStore((state) => state.login);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const rememberedIdentifier = window.localStorage.getItem("omni_studio-remembered-identifier");
      if (rememberedIdentifier) {
        setIdentifier(rememberedIdentifier);
        setRememberMe(true);
      }
    } catch {
      // Local storage may be unavailable in hardened webviews.
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      try {
        if (rememberMe) window.localStorage.setItem("omni_studio-remembered-identifier", identifier);
        else window.localStorage.removeItem("omni_studio-remembered-identifier");
      } catch {
        // Remember-me is best effort and must not block authentication.
      }
      await login({ identifier, password });
      window.location.hash = consumeReturnHash("#/workspace");
    } catch (requestError) {
      const status = getApiErrorStatus(requestError);
      const code = getApiErrorCode(requestError);
      if (status === 401 && code === "AUTH_INVALID_CREDENTIALS") {
        setError(t("errorInvalidCredentials"));
      } else if (status === 403 && code === "AUTH_CSRF_FAILED") {
        setError(t("errorCsrf"));
      } else if (status === 429 && code === "AUTH_RATE_LIMITED") {
        setError(t("errorRateLimited"));
      } else {
        setError(t("errorLoginFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main data-testid="auth-surface" className={styles.page}>
      <header className={styles.header}>
        <div data-testid="auth-brand" className={styles.brand}>
          <Image src={brandMark} alt="Omni Studio" width={30} height={30} />
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

        <section data-testid="auth-panel" className={styles.panel} aria-labelledby="login-title">
          <div className={styles.panelHeading}>
            <span className={styles.chapter} aria-hidden="true">LET’S CREATE</span>
            <h1 id="login-title">{t("loginTitle")}</h1>
            <p>{t("loginSubtitle")}</p>
          </div>
          <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting}>
            <TextField className={styles.field} label={t("identifier")} name="username" value={identifier} onChange={setIdentifier} autoComplete="username" isRequired />
            <PasswordField className={styles.field} label={t("password")} name="password" value={password} onChange={setPassword} autoComplete="current-password" isRequired minLength={8} maxLength={128} showPasswordLabel={t("showPassword")} hidePasswordLabel={t("hidePassword")} />

            <div className={styles.options}>
              <Checkbox className={styles.remember} isSelected={rememberMe} onChange={setRememberMe}>{t("rememberMe")}</Checkbox>
              <Button type="button" variant="quiet" className={styles.textButton} onPress={() => { window.location.hash = "#/reset-password"; }}>
                {t("forgotPassword")}
              </Button>
            </div>

            {error && (
              <div role="alert" className={styles.error}>
                <AlertCircle size={17} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" isPending={submitting} className={styles.submit}>
              <span>{submitting ? t("loggingIn") : t("login")}</span>
              {!submitting && <ArrowUpRight size={21} />}
            </Button>

            <p className={styles.invite}>
              {t("noAccount")}{" "}
              <Button type="button" variant="quiet" onPress={() => setError(t("contactAdminHint"))} className={styles.textButton}>
                {t("contactAdmin")}
              </Button>
            </p>
          </form>
        </section>
      </div>
      <footer className={styles.footer}>
        <span>OMNI STUDIO</span>
        <span>STORIES, RENDERED ALIVE.</span>
      </footer>
    </main>
  );
}
