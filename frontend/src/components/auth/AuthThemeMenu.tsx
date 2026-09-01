"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSettingsStore, type ThemeMode } from "@/store/settingsStore";

export default function AuthThemeMenu() {
  const t = useTranslations("auth");
  const themeMode = useSettingsStore((state) => state.themeMode);
  const setThemeMode = useSettingsStore((state) => state.setThemeMode);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectMode = (mode: ThemeMode) => {
    const systemPrefersDark = mode === "system"
      ? window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true
      : undefined;
    setThemeMode(mode, systemPrefersDark);
    setOpen(false);
  };

  const ActiveIcon = themeMode === "light" ? Sun : themeMode === "system" ? Monitor : Moon;
  const options = [
    { mode: "light" as const, label: t("themeLight"), Icon: Sun },
    { mode: "dark" as const, label: t("themeDark"), Icon: Moon },
    { mode: "system" as const, label: t("themeSystem"), Icon: Monitor },
  ];

  return (
    <div ref={menuRef} className="auth-theme-control">
      <button
        type="button"
        className="auth-theme-trigger"
        aria-label={t("themeSwitch")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("themeSwitch")}
        onClick={() => setOpen((visible) => !visible)}
      >
        <ActiveIcon size={18} />
      </button>
      {open && (
        <div className="auth-theme-menu" role="menu" aria-label={t("themeSwitch")}>
          {options.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              type="button"
              role="menuitemradio"
              aria-checked={themeMode === mode}
              className="auth-theme-option"
              onClick={() => selectMode(mode)}
            >
              <Icon size={16} />
              <span>{label}</span>
              <Check className="auth-theme-check" size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
