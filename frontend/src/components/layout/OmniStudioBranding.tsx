"use client";

import { useState, useEffect } from "react";

interface OmniStudioBrandingProps {
  size?: "sm" | "md" | "lg";
  showSlogan?: boolean;
  className?: string;
  variant?: "default" | "auth";
}

const LOGO_SRC = "/omni-studio-logo.png";

export default function OmniStudioBranding({
  size = "md",
  showSlogan = true,
  className = "",
  variant = "default",
}: OmniStudioBrandingProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Keep the server/client markup stable while the asset is being loaded.
  const logoWidth = size === "sm" ? 120 : size === "lg" ? 240 : 168;
  const opacity = mounted ? 1 : 0.98;

  return (
    <div className={className}>
      <div className={variant === "auth" ? "flex justify-center" : "flex items-center"}>
        <img
          src={LOGO_SRC}
          alt="Omni Studio"
          className="object-contain"
          style={{ width: logoWidth, height: "auto", opacity }}
        />
      </div>
      {showSlogan && (
        <p className="font-mono atelier-display text-[0.5rem] text-text-muted tracking-[0.15em] text-center mt-2.5 uppercase">
          Stories, Rendered Alive.
        </p>
      )}
    </div>
  );
}
