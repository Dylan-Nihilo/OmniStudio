"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Check, Sparkles, ExternalLink, CircleAlert } from "lucide-react";

import { Button } from "@omnistudio/ui";

// 本地版本常量,避免跨文件耦合(与 SettingsPage 的 APP_VERSION 同源)。
const APP_VERSION = "v0.2.0";
const REPO = "Dylan-Nihilo/OmniStudio";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases`;

type Status = "idle" | "checking" | "latest" | "update" | "error";

/** 解析为可比较的数字段:剥离前导 v,按 . + - 拆分,非数字视作 0。 */
function parseSemver(v: string): number[] {
  return v
    .trim()
    .replace(/^[vV]/, "")
    .split(/[.+-]/)
    .map((s) => {
      const n = parseInt(s, 10);
      return Number.isNaN(n) ? 0 : n;
    });
}

/** remote 是否比 current 更新(逐段数字比较,短的补 0;相等视为非更新)。 */
function isNewer(remote: string, current: string): boolean {
  const a = parseSemver(remote);
  const b = parseSemver(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export default function UpdateChecker() {
  const t = useTranslations("settings");
  const [status, setStatus] = useState<Status>("idle");
  const [remoteTag, setRemoteTag] = useState("");
  const [releaseUrl, setReleaseUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState(() => t("updateError"));

  const checking = status === "checking";

  const openReleases = (url?: string) =>
    window.open(url || RELEASES_URL, "_blank", "noopener,noreferrer");

  const handleCheck = async () => {
    if (checking) return;
    setStatus("checking");
    setErrorMsg(t("updateError"));
    try {
      const res = await fetch(LATEST_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      // 404 = 仓库尚无任何 release;403 通常是未授权限流。
      if (res.status === 404) {
        setErrorMsg(t("updateNoRelease"));
        setStatus("error");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json();
      const tag: string = typeof data?.tag_name === "string" ? data.tag_name : "";
      const url: string = typeof data?.html_url === "string" ? data.html_url : "";
      if (!tag) {
        setStatus("error");
        return;
      }
      setRemoteTag(tag);
      setReleaseUrl(url);
      setStatus(isNewer(tag, APP_VERSION) ? "update" : "latest");
    } catch {
      setStatus("error");
    }
  };

  // 状态文案颜色:中性信息 secondary / 低调错误 muted / 新版用 accent(amber)。
  const statusColor =
    status === "update"
      ? "text-accent"
      : status === "error"
        ? "text-text-muted"
        : "text-text-secondary";

  const showOpenButton = status === "update" || status === "error";

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap py-2.5 border-t border-glass-border text-[0.78125rem]">
      <span className="text-text-secondary shrink-0">{t("updateLabel")}</span>

      <div className="flex items-center gap-2.5 flex-wrap justify-end">
        {/* 结果区:屏幕阅读器实时播报 */}
        <span
          role="status"
          aria-live="polite"
          className={`inline-flex items-center gap-1.5 font-mono text-[0.71875rem] ${statusColor}`}
        >
          {status === "latest" && (
            <>
              <Check size={13} />
              {t("updateUpToDate", { version: APP_VERSION })}
            </>
          )}
          {status === "update" && (
            <>
              <Sparkles size={13} />
              {t("updateNewVersion", { version: remoteTag })}
            </>
          )}
          {status === "error" && (
            <>
              <CircleAlert size={13} />
              {errorMsg}
            </>
          )}
        </span>

        {showOpenButton && (
          <Button
            variant="quiet"
            onPress={() => openReleases(status === "update" ? releaseUrl : undefined)}

            aria-label={t("updateOpenReleaseAria")}
          >
            {t("updateOpenRelease")}
            <ExternalLink size={12} />
          </Button>
        )}

        <Button variant="secondary" onPress={handleCheck} isPending={checking} aria-label={t("updateCheckAria")}>
          <RefreshCw size={16} />
          {checking ? t("updateChecking") : t("updateCheck")}
        </Button>
      </div>
    </div>
  );
}
