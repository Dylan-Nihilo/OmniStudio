import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiClient, API_URL, clearReturnHash } from "@/lib/apiClient";

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
  bootstrap: () => Promise<void>;
  setup: (input: OwnerSetupInput) => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  changePassword: (input: ChangePasswordInput) => Promise<void>;
  getPasswordResetStatus: () => Promise<PasswordResetStatus>;
  resetPassword: (input: PasswordResetInput) => Promise<void>;
  clearSession: () => void;
}

let bootstrapPromise: Promise<void> | null = null;

const authenticatedStatus = (current: SetupStatus | null): SetupStatus => ({
  initialized: true,
  setup_allowed: false,
  setup_token_required: current?.setup_token_required ?? false,
});

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      initialized: false,
      setupStatus: null,
      user: null,
      bootstrapping: true,

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
            set({ user: data.user });
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
        const payload = {
          ...input,
          setup_token: input.setup_token?.trim() || undefined,
        };
        const { data } = await apiClient.post<AuthResponse>(`${API_URL}/auth/setup`, payload);
        set((state) => ({
          initialized: true,
          setupStatus: authenticatedStatus(state.setupStatus),
          user: data.user,
        }));
      },

      login: async (input) => {
        const { data } = await apiClient.post<AuthResponse>(`${API_URL}/auth/login`, input);
        set((state) => ({
          initialized: true,
          setupStatus: authenticatedStatus(state.setupStatus),
          user: data.user,
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
        await apiClient.post(`${API_URL}/auth/password-reset`, {
          ...input,
          recovery_token: input.recovery_token?.trim() || undefined,
        });
        get().clearSession();
        clearReturnHash();
      },

      clearSession: () => set({ user: null }),
    }),
    {
      name: "lumenx-auth",
      partialize: (state) => ({
        setupStatus: state.setupStatus,
        user: state.user,
      }),
    },
  ),
);
