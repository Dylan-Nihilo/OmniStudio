import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiClient, API_URL, clearReturnHash, refreshCsrfToken } from "@/lib/apiClient";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface SetupStatus {
  initialized: boolean;
  setup_allowed: boolean;
  setup_token_required: boolean;
}

export interface OwnerSetupInput {
  username: string;
  email: string;
  password: string;
  setup_token?: string;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}

export interface PasswordResetStatus {
  available: boolean;
  token_required: boolean;
}

export interface PasswordResetInput {
  identifier: string;
  new_password: string;
  recovery_token?: string;
}

interface AuthResponse {
  user: AuthUser;
}

interface MeResponse {
  user: AuthUser;
}

interface AuthStore {
  initialized: boolean;
  setupStatus: SetupStatus | null;
  user: AuthUser | null;
  bootstrapping: boolean;
  legacyClaimPending: boolean;
  legacyClaimAcknowledged: boolean;
  bootstrap: () => Promise<void>;
  setup: (input: OwnerSetupInput) => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  changePassword: (input: ChangePasswordInput) => Promise<void>;
  getPasswordResetStatus: () => Promise<PasswordResetStatus>;
  resetPassword: (input: PasswordResetInput) => Promise<void>;
  clearSession: () => void;
  finishLegacyClaim: () => void;
}

let bootstrapPromise: Promise<void> | null = null;

const authenticatedStatus = (current: SetupStatus | null): SetupStatus => ({
  initialized: true,
  setup_allowed: false,
  setup_token_required: current?.setup_token_required ?? false,
});

interface ClaimDiscoveryResponse {
  summary: { projects: number; series: number; media: number; conflicts: number };
  batch: { id: string } | null;
}

const hasLegacyClaimWork = (status: ClaimDiscoveryResponse): boolean =>
  Boolean(
    status.batch ||
      status.summary.projects ||
      status.summary.series ||
      status.summary.media ||
      status.summary.conflicts,
  );

const discoverLegacyClaim = async (): Promise<boolean> => {
  try {
    const { data } = await apiClient.get<ClaimDiscoveryResponse>(`${API_URL}/auth/legacy-claim/status`);
    return hasLegacyClaimWork(data);
  } catch {
    return false;
  }
};

const isCsrfFailure = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== "object") return false;
  const payload = (response as { data?: unknown }).data;
  if (!payload || typeof payload !== "object") return false;
  const errorEnvelope = (payload as { error?: unknown }).error;
  return (
    Boolean(errorEnvelope) &&
    typeof errorEnvelope === "object" &&
    (errorEnvelope as { code?: unknown }).code === "AUTH_CSRF_FAILED"
  );
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      initialized: false,
      setupStatus: null,
      user: null,
      bootstrapping: true,
      legacyClaimPending: false,
      legacyClaimAcknowledged: false,

      bootstrap: async () => {
        if (bootstrapPromise) return bootstrapPromise;

        set({ bootstrapping: true });
        bootstrapPromise = (async () => {
          const { data: setupStatus } = await apiClient.get<SetupStatus>(`${API_URL}/auth/setup-status`);
          set({
            initialized: setupStatus.initialized,
            setupStatus,
            user: setupStatus.initialized ? get().user : null,
          });

          if (!setupStatus.initialized) return;

          try {
            const { data } = await apiClient.get<MeResponse>(`${API_URL}/auth/me`);
            const claimPending = await discoverLegacyClaim();
            set({
              user: data.user,
              legacyClaimPending: !get().legacyClaimAcknowledged && claimPending,
            });
          } catch {
            // Any failure to confirm the session (401, expired refresh, network)
            // means there is no valid logged-in identity right now.
            set({ user: null });
          }
        })().finally(() => {
          set({ bootstrapping: false });
          bootstrapPromise = null;
        });

        return bootstrapPromise;
      },

      setup: async (input) => {
        await refreshCsrfToken();
        const payload = {
          ...input,
          setup_token: input.setup_token?.trim() || undefined,
        };
        const { data } = await apiClient.post<AuthResponse>(`${API_URL}/auth/setup`, payload);
        set((state) => ({
          initialized: true,
          setupStatus: authenticatedStatus(state.setupStatus),
          user: data.user,
          legacyClaimPending: true,
          legacyClaimAcknowledged: false,
        }));
      },

      login: async (input) => {
        await refreshCsrfToken();
        let response;
        try {
          response = await apiClient.post<AuthResponse>(`${API_URL}/auth/login`, input);
        } catch (error) {
          if (!isCsrfFailure(error)) throw error;
          // A backend restart or expired session can leave a stale CSRF cookie.
          // Refresh the anonymous token once, then retry the same login request.
          await refreshCsrfToken();
          response = await apiClient.post<AuthResponse>(`${API_URL}/auth/login`, input);
        }
        const { data } = response;
        const claimPending = await discoverLegacyClaim();
        set((state) => ({
          initialized: true,
          setupStatus: authenticatedStatus(state.setupStatus),
          user: data.user,
          legacyClaimPending: !state.legacyClaimAcknowledged && claimPending,
        }));
      },

      logout: async () => {
        let requestError: unknown;
        try {
          await apiClient.post(`${API_URL}/auth/logout`);
        } catch (error) {
          requestError = error;
        } finally {
          get().clearSession();
          clearReturnHash();
          if (typeof window !== "undefined" && window.location.hash !== "#/login") {
            window.location.hash = "#/login";
          }
        }
        if (requestError) throw requestError;
      },

      refreshUser: async () => {
        const { data } = await apiClient.get<MeResponse>(`${API_URL}/auth/me`);
        set({ user: data.user });
      },

      changePassword: async (input) => {
        await apiClient.post(`${API_URL}/auth/change-password`, input);
        get().clearSession();
        clearReturnHash();
      },

      getPasswordResetStatus: async () => {
        const { data } = await apiClient.get<PasswordResetStatus>(
          `${API_URL}/auth/password-reset/status`,
        );
        return data;
      },

      resetPassword: async (input) => {
        await refreshCsrfToken();
        await apiClient.post(`${API_URL}/auth/password-reset`, {
          ...input,
          recovery_token: input.recovery_token?.trim() || undefined,
        });
        get().clearSession();
        clearReturnHash();
      },

      clearSession: () => set({ user: null, legacyClaimPending: false }),
      finishLegacyClaim: () => set({
        legacyClaimPending: false,
        legacyClaimAcknowledged: true,
      }),
    }),
    {
      name: "omni_studio-auth",
      partialize: (state) => ({
        setupStatus: state.setupStatus,
        user: state.user,
        legacyClaimPending: state.legacyClaimPending,
        legacyClaimAcknowledged: state.legacyClaimAcknowledged,
      }),
    },
  ),
);
