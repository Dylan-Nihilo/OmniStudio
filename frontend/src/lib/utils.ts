import { API_URL } from "./api";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function getAssetUrl(path: string | null | undefined): string {
    if (!path) return "";
    const normalizedPath = path.replaceAll("\\", "/");
    const mediaBase = typeof window !== "undefined"
        && window.location.origin !== API_URL
        && !window.location.protocol.startsWith("tauri")
        ? "/api-proxy"
        : API_URL;
    const scopeMediaUrl = (url: string): string => {
        const workspaceId = typeof window !== "undefined" ? window.localStorage.getItem("omni_studio.activeWorkspaceId") : null;
        if (!workspaceId) return url;
        const [pathname, query = ""] = url.split("?");
        const params = new URLSearchParams(query);
        if (!params.has("workspace_id")) params.set("workspace_id", workspaceId);
        return `${pathname}?${params}`;
    };
    if (path.startsWith("http") || path.startsWith("blob:")) {
        // Only pass through well-formed http(s)/blob URLs; anything else
        // (e.g. javascript: smuggled behind a weird prefix) is dropped.
        try {
            const protocol = new URL(path).protocol;
            if (protocol === "http:" || protocol === "https:" || protocol === "blob:") {
                // Strip HTML metacharacters as well; well-formed URLs never
                // contain them raw, so this is a no-op for legitimate values.
                const cleanUrl = path.replace(/[<>"'`]/g, "");
                try {
                    const parsed = new URL(cleanUrl);
                    if (parsed.origin === API_URL && parsed.pathname.startsWith("/files/")) {
                        return scopeMediaUrl(`${mediaBase}${parsed.pathname}${parsed.search}`);
                    }
                } catch {
                    // Keep the validated URL below when parsing is unavailable.
                }
                return cleanUrl;
            }
        } catch {
            // malformed URL — fall through to reject
        }
        return "";
    }

    if (normalizedPath.startsWith("/api-proxy/files/")) return scopeMediaUrl(normalizedPath);
    if (normalizedPath.startsWith("/files/")) return scopeMediaUrl(`${mediaBase}${normalizedPath}`);
    // Remove leading slash if present to avoid double slashes with the media route.
    const cleanPath = normalizedPath.startsWith("/") ? normalizedPath.slice(1) : normalizedPath;
    return scopeMediaUrl(`${mediaBase}/files/${encodeURI(cleanPath)}`);
}

export function getAssetUrlWithTimestamp(path: string | null | undefined, timestamp?: number): string {
    const baseUrl = getAssetUrl(path);
    if (!baseUrl) return "";

    // If URL already has query params, append with & otherwise with ?
    const separator = baseUrl.includes('?') ? '&' : '?';
    return baseUrl + separator + `t=${timestamp || 0}`;
}

export function extractErrorDetail(error: any, fallback = "未知错误"): string {
    return error?.response?.data?.detail
        || error?.response?.data?.message
        || error?.message
        || fallback;
}
