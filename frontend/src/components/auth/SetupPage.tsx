"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuthStore } from "@/store/authStore";
import { Button, PasswordField, TextField } from "@omnistudio/ui";
import AuthLayout from "./AuthLayout";
import LegacyClaimPanel from "./LegacyClaimPanel";
import authStyles from "./LoginPage.module.css";
import styles from "./SetupPage.module.css";

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error !== "object" || error === null) return fallback;
  const response = (error as { response?: { data?: { error?: { message?: string } } } }).response;
  return response?.data?.error?.message || fallback;
};

export default function SetupPage() {
  const t = useTranslations("auth");
  const setup = useAuthStore((state) => state.setup);
  const setupStatus = useAuthStore((state) => state.setupStatus);
  const legacyClaimPending = useAuthStore((state) => state.legacyClaimPending);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (password !== confirmPassword) {
      setError(t("errorPasswordsDoNotMatch"));
      return;
    }

    setSubmitting(true);
    try {
      await setup({ username, email, password, setup_token: setupToken });
    } catch (submitError) {
      setError(getErrorMessage(submitError, t("errorSetupFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  if (setupStatus?.initialized && legacyClaimPending) {
    return <LegacyClaimPanel />;
  }

  const tokenField = (
    <TextField className={authStyles.field} label={t("setupToken")} description={t("setupTokenHint")} name="setup_token" type="password" value={setupToken} onChange={setSetupToken} autoComplete="off" isRequired={setupStatus?.setup_token_required} isDisabled={submitting} />
  );

  return (
    <AuthLayout title={t("setupTitle")} subtitle={t("setupSubtitle")} titleId="setup-title">
      {setupStatus && !setupStatus.setup_allowed ? (
        <p role="status" className={styles.notice}>{t("setupNotAllowed")}</p>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting}>
          <TextField className={authStyles.field} label={t("username")} name="username" value={username} onChange={setUsername} autoComplete="username" isRequired maxLength={128} isDisabled={submitting} autoFocus />
          <TextField className={authStyles.field} label={t("email")} name="email" type="email" value={email} onChange={setEmail} autoComplete="email" isRequired isDisabled={submitting} />
          <div className={styles.passwords}>
            <PasswordField className={authStyles.field} label={t("password")} description={t("passwordRequirements")} name="password" value={password} onChange={setPassword} autoComplete="new-password" isRequired minLength={8} maxLength={128} isDisabled={submitting} showPasswordLabel={t("showPassword")} hidePasswordLabel={t("hidePassword")} />
            <PasswordField className={authStyles.field} label={t("confirmPassword")} name="confirm_password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" isRequired minLength={8} maxLength={128} isDisabled={submitting} showPasswordLabel={t("showPassword")} hidePasswordLabel={t("hidePassword")} />
          </div>

          {setupStatus?.setup_token_required ? tokenField : (
            <details className={styles.token}>
              <summary>{t("setupToken")} <span>{t("optional")}</span></summary>
              {tokenField}
            </details>
          )}

          {error && (
            <div role="alert" className={authStyles.error}>
              <AlertCircle size={17} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" isPending={submitting} fullWidth className={authStyles.submit}>
            <span>{submitting ? t("settingUp") : t("setupAction")}</span>
            {!submitting && <ArrowUpRight size={21} aria-hidden="true" />}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
