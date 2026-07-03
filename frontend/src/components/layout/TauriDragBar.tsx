"use client";

import { isTauri } from "@/lib/transport";

/**
 * Invisible drag bar at the top of the window for Tauri desktop mode.
 * Allows users to drag the window from the top 38px area (same height as macOS titlebar).
 * Only renders in Tauri environment.
 */
export default function TauriDragBar() {
  if (!isTauri()) return null;

  return <div className="tauri-drag-bar" data-tauri-drag-region />;
}
