import axios, {
  AxiosHeaders,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from "axios";

const BACKEND_PORT = process.env.NEXT_PUBLIC_BACKEND_PORT || "17177";

const getApiUrl = (): string => {
  const override = process.env.NEXT_PUBLIC_API_URL;
  if (override && override.trim()) {
    return override.trim().replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;

    if (protocol === "tauri:" || (protocol === "https:" && hostname === "tauri.localhost")) {
      return `http://127.0.0.1:${BACKEND_PORT}`;
    }

    if (process.env.NODE_ENV === "development") {
      // Keep browser requests same-origin in development. Next.js proxies
      // `/api-proxy/*` to the standalone backend, which avoids CORS and local
      // browser policies blocking cross-port requests (for example 3008 ->
      // 17177).
      return "/api-proxy";
    }

    return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  }

  return `http://localhost:${BACKEND_PORT}`;
};

export const API_URL = getApiUrl();
export const AUTH_RETURN_TO_KEY = "lumenx.auth.returnTo";
const CSRF_COOKIE_NAME = "lumenx_csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const MUTATING_METHODS = new Set(["post", "put", "patch", "delete"]);

export const isSafeReturnHash = (value: unknown): value is string =>
  typeof value === "string" &&
  value.startsWith("#/") &&
  value !== "#/login" &&
  value !== "#/setup" &&
  value !== "#/reset-password";

export const rememberReturnHash = (value?: string): void => {
  if (typeof window === "undefined") return;
  const candidate = value ?? window.location.hash;
  if (!isSafeReturnHash(candidate)) return;
  try {
    window.sessionStorage.setItem(AUTH_RETURN_TO_KEY, candidate);
  } catch {
    // sessionStorage may be unavailable in hardened webviews.
  }
};

export const clearReturnHash = (): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
  } catch {
    // sessionStorage may be unavailable in hardened webviews.
  }
};

export const consumeReturnHash = (fallback = "#/workspace"): string => {
  if (typeof window === "undefined") return fallback;
  let candidate: string | null = null;
  try {
    candidate = window.sessionStorage.getItem(AUTH_RETURN_TO_KEY);
    window.sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
  } catch {
    // sessionStorage may be unavailable in hardened webviews.
  }
  return isSafeReturnHash(candidate) ? candidate : fallback;
};

const readCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return entry.slice(prefix.length);
  }
};

const attachCsrfHeader = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  const method = config.method?.toLowerCase();
  if (!method || !MUTATING_METHODS.has(method)) return config;

  const csrfToken = readCookie(CSRF_COOKIE_NAME);
  if (!csrfToken) return config;

  const headers = AxiosHeaders.from(config.headers);
  headers.set(CSRF_HEADER_NAME, csrfToken);
  config.headers = headers;
  return config;
};

const bareClient = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 30_000,
});
bareClient.interceptors.request.use(attachCsrfHeader);

export const apiClient = axios.create({
  // Callers pass the complete API_URL-prefixed path. Keeping a base URL here
  // would make Axios combine `/api-proxy` with `/api-proxy/...` in development,
  // producing `/api-proxy/api-proxy/...` and a misleading 404 from Next.js.
  // `bareClient` below intentionally keeps API_URL as its base for the few
  // auth requests that use relative paths.
  baseURL: "",
  withCredentials: true,
  timeout: 30_000,
});
apiClient.interceptors.request.use(attachCsrfHeader);

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };
let refreshPromise: Promise<void> | null = null;
let redirectingAfterAuthFailure = false;

const requestPath = (config?: InternalAxiosRequestConfig): string => {
  const rawUrl = config?.url || "";
  let path: string;
  try {
    const base = config?.baseURL || API_URL;
    path = new URL(rawUrl, base.startsWith("http") ? base : "http://localhost").pathname;
  } catch {
    path = rawUrl.split("?")[0];
  }
  return path.startsWith("/api-proxy/") ? path.slice("/api-proxy".length) : path;
};

const REFRESH_EXCLUDED_PATHS = new Set([
  "/auth/setup-status",
  "/auth/setup",
  "/auth/login",
  "/auth/password-reset/status",
  "/auth/password-reset",
  "/auth/refresh",
  "/auth/me",
]);

const isRefreshExcludedEndpoint = (config?: InternalAxiosRequestConfig): boolean =>
  REFRESH_EXCLUDED_PATHS.has(requestPath(config));

const clearAuthState = async (): Promise<void> => {
  try {
    const { useAuthStore } = await import("@/store/authStore");
    useAuthStore.getState().clearSession();
  } catch {
    // The redirect still protects the shell if the store chunk cannot load.
  }
};

export const redirectToLogin = async (preserveReturnTo = true): Promise<void> => {
  if (typeof window === "undefined" || redirectingAfterAuthFailure) return;
  redirectingAfterAuthFailure = true;
  if (preserveReturnTo) rememberReturnHash();
  else clearReturnHash();
  await clearAuthState();
  if (window.location.hash !== "#/login") window.location.hash = "#/login";
  queueMicrotask(() => {
    redirectingAfterAuthFailure = false;
  });
};

const redirectToSetup = async (): Promise<void> => {
  if (typeof window === "undefined") return;
  try {
    const { useAuthStore } = await import("@/store/authStore");
    useAuthStore.setState({ initialized: false, setupStatus: null, user: null });
    try {
      const { data } = await bareClient.get<{
        initialized: boolean;
        setup_allowed: boolean;
        setup_token_required: boolean;
      }>("/auth/setup-status");
      useAuthStore.setState({ initialized: data.initialized, setupStatus: data, user: null });
    } catch {
      // Keep the conservative setup-required state until the next bootstrap/reload.
    }
  } catch {
    await clearAuthState();
  }
  if (window.location.hash !== "#/setup") window.location.hash = "#/setup";
};

const refreshSession = (): Promise<void> => {
  if (!refreshPromise) {
    refreshPromise = bareClient
      .post("/auth/refresh")
      .then(() => undefined)
      .catch(async (error) => {
        await redirectToLogin(true);
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

/**
 * Native fetch escape hatch for streaming responses. Regular JSON/blob/form
 * requests should use apiClient so all callers share the Axios interceptors.
 */
export const apiStreamRequest = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const execute = (): Promise<Response> => {
    const method = (init.method || "GET").toLowerCase();
    const headers = new Headers(init.headers);
    if (MUTATING_METHODS.has(method) && !headers.has(CSRF_HEADER_NAME)) {
      const csrfToken = readCookie(CSRF_COOKIE_NAME);
      if (csrfToken) headers.set(CSRF_HEADER_NAME, csrfToken);
    }

    return fetch(url, {
      ...init,
      headers,
      credentials: "include",
    });
  };

  let response = await execute();
  if (response.status === 428) {
    await redirectToSetup();
    return response;
  }
  if (
    response.status !== 401 ||
    isRefreshExcludedEndpoint({ url } as InternalAxiosRequestConfig)
  ) {
    return response;
  }

  await refreshSession();
  response = await execute();
  if (response.status === 401) await redirectToLogin(true);
  if (response.status === 428) await redirectToSetup();
  return response;
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const originalRequest = error.config as RetryableConfig | undefined;

    if (status === 428) {
      await redirectToSetup();
      return Promise.reject(error);
    }

    if (status === 401 && originalRequest?._retry && !isRefreshExcludedEndpoint(originalRequest)) {
      await redirectToLogin(true);
      return Promise.reject(error);
    }

    if (status !== 401 || !originalRequest || isRefreshExcludedEndpoint(originalRequest)) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    await refreshSession();
    return apiClient(originalRequest);
  },
);

