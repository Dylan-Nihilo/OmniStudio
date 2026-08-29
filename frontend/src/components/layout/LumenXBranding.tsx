"use client";

import { useState, useEffect } from "react";
import { useSettingsStore, type ThemePreset } from "@/store/settingsStore";

interface LumenXBrandingProps {
  size?: "sm" | "md" | "lg";
  showSlogan?: boolean;
  className?: string;
  variant?: "default" | "auth";
}

// MANGIX 标识使用高对比度 SVG 变体，适配深浅主题。
const LOGO_SRC: Record<ThemePreset, string> = {
  "atelier-dark": "/mangix-mark-gpt.png",
  "bridge-dark": "/mangix-mark-gpt.png",
  "brand-dark": "/mangix-mark-gpt.png",
  "atelier-light": "/mangix-mark-gpt-light.png",
  "brand-light": "/mangix-mark-gpt-light.png",
};

export default function LumenXBranding({
  size = "md",
  showSlogan = true,
  className = "",
  variant = "default",
}: LumenXBrandingProps) {
  const logoPixels = size === "sm" ? 36 : size === "lg" ? 68 : 56;
  const titleSize = size === "sm" ? "text-lg" : size === "lg" ? "text-[1.65rem]" : "text-xl";

  const theme = useSettingsStore((s) => s.theme);
  // SSR 与客户端首次渲染统一用默认主题，避免 logo src/filter 的 hydration
  // mismatch；挂载后切到实际主题。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const activeTheme: ThemePreset = mounted ? theme : "atelier-dark";
  const logoSrc = variant === "auth"
    ? "/mangix-mark-gpt.png"
    : LOGO_SRC[activeTheme] ?? "/mangix-mark-gpt.png";

  return (
    <div className={className}>
      <div className={variant === "auth" ? "flex flex-col items-center gap-2" : "flex items-center gap-3"}>
        <div className="flex-shrink-0">
          <img
            src={logoSrc}
            alt="MANGIX Studio"
            className="object-contain"
            style={{ width: logoPixels, height: logoPixels }}
          />
        </div>
        <div className={variant === "auth" ? "flex flex-col items-center justify-center" : "flex flex-col justify-center"}>
          <div className="flex items-baseline gap-0">
            <span className={`font-mono ${titleSize} font-bold tracking-[0.08em] text-foreground`}>
              MANGIX
            </span>
          </div>
          {size !== "sm" && (
            <span className="font-mono text-[0.6875rem] text-text-muted tracking-[0.24em] uppercase -mt-0.5">
              STUDIO
            </span>
          )}
        </div>
      </div>
      {showSlogan && (
        <p className="font-mono atelier-display text-[0.5rem] text-text-muted tracking-[0.15em] text-center mt-2.5 uppercase">
          Stories, Rendered Alive.
        </p>
      )}
    </div>
  );
}
