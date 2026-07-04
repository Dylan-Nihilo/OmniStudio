"use client";

import { useEffect } from "react";
import { isTauri } from "@/lib/transport";

/**
 * Listens for native menu events emitted from the Tauri Rust backend
 * and maps them to frontend actions (navigation, zoom, dialogs).
 *
 * Props:
 *   onNewProject – callback to open the Create Project dialog
 */
interface TauriMenuListenerProps {
  onNewProject?: () => void;
}

// Zoom state (percentages). Base is 87.5% as set by the inline script.
const ZOOM_BASE = 87.5;
const ZOOM_STEP = 6.25; // ~1px per step at 16px root
const ZOOM_MIN = 62.5;
const ZOOM_MAX = 125;

let currentZoom = ZOOM_BASE;

function applyZoom(pct: number) {
  currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pct));
  document.documentElement.style.fontSize = `${currentZoom}%`;
}

export default function TauriMenuListener({ onNewProject }: TauriMenuListenerProps) {
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<string>("menu-action", (event) => {
        const action = event.payload;

        switch (action) {
          case "preferences":
            window.location.hash = "#/settings";
            break;
          case "new_project":
            onNewProject?.();
            break;
          case "open_project":
            window.location.hash = "#/";
            break;
          case "zoom_in":
            applyZoom(currentZoom + ZOOM_STEP);
            break;
          case "zoom_out":
            applyZoom(currentZoom - ZOOM_STEP);
            break;
          case "zoom_reset":
            applyZoom(ZOOM_BASE);
            break;
          default:
            break;
        }
      });
    };

    setup();

    return () => {
      unlisten?.();
    };
  }, [onNewProject]);

  return null;
}
