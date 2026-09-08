import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiClient, AUTH_API_URL, clearReturnHash, refreshCsrfToken } from "@/lib/apiClient";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string | null;
  role: "owner" | "member";
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

export interface InvitationRegistrationInput extends OwnerSetupInput {
  token: string;
  display_name?: string;
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
  workspace: WorkspaceSummary;
}

interface MeResponse {
  user: AuthUser;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
}

interface AuthStore {
  initialized: boolean;
  setupStatus: SetupStatus | null;
  user: AuthUser | null;
  activeWorkspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  bootstrapping: boolean;
  legacyClaimPending: boolean;
  legacyClaimAcknowledged: boolean;
  bootstrap: () => Promise<void>;
  setup: (input: OwnerSetupInput) => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  registerInvitation: (input: InvitationRegistrationInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<WorkspaceSummary>;
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

export const ACTIVE_WORKSPACE_KEY = "omni_studio.activeWorkspaceId";

const rememberActiveWorkspace = (workspace: WorkspaceSummary | null): void => {
  if (typeof window === "undefined") return;
  if (workspace) window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspace.id);
  else window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
};

const rehydrateProjectWorkspace = async (): Promise<void> => {
  const { useProjectStore } = await import("@/store/projectStore");
  useProjectStore.setState({
    projects: [],
    currentProject: null,
    seriesList: [],
    currentSeries: null,
  });
  await useProjectStore.persist.rehydrate();
};

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
    const { data } = await apiClient.get<ClaimDiscoveryResponse>(`${AUTH_API_URL}/auth/legacy-claim/status`);
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
      activeWorkspace: null,
      workspaces: [],
      bootstrapping: true,
      legacyClaimPending: false,
      legacyClaimAcknowledged: false,

      bootstrap: async () => {
        if (bootstrapPromise) return bootstrapPromise;

        set({ bootstrapping: true });
        bootstrapPromise = (async () => {
          const { data: setupStatus } = await apiClient.get<SetupStatus>(`${AUTH_API_URL}/auth/setup-status`);
          set({
            initialized: setupStatus.initialized,
            setupStatus,
            user: setupStatus.initialized ? get().user : null,
          });

          if (!setupStatus.initialized) return;

          try {
            const { data } = await apiClient.get<MeResponse>(`${AUTH_API_URL}/auth/me`);
            const claimPending = await discoverLegacyClaim();
            set({
              user: data.user,
              activeWorkspace:
                data.workspaces.find((workspace) => workspace.id === window.localStorage.getItem(ACTIVE_WORKSPACE_KEY)) ??
                data.workspace,
              workspaces: data.workspaces,
              legacyClaimPending: !get().legacyClaimAcknowledged && claimPending,
            });
            rememberActiveWorkspace(
              data.workspaces.find((workspace) => workspace.id === window.localStorage.getItem(ACTIVE_WORKSPACE_KEY)) ??
                data.workspace,
            );
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
        const { data } = await apiClient.post<AuthResponse>(`${AUTH_API_URL}/auth/setup`, payload);
        set((state) => ({
          initialized: true,
          setupStatus: authenticatedStatus(state.setupStatus),
          user: data.user,
          activeWorkspace: data.workspace,
          workspaces: [data.workspace],
          legacyClaimPending: true,
          legacyClaimAcknowledged: false,
        }));
        rememberActiveWorkspace(data.workspace);
        await rehydrateProjectWorkspace();
      },

      login: async (input) => {
        await refreshCsrfToken();
        let response;
        try {
          response = await apiClient.post<AuthResponse>(`${AUTH_API_URL}/auth/login`, input);
        } catch (error) {
          if (!isCsrfFailure(error)) throw error;
          // A backend restart or expired session can leave a stale CSRF cookie.
          // Refresh the anonymous token once, then retry the same login request.
          await refreshCsrfToken();
          response = await apiClient.post<AuthResponse>(`${AUTH_API_URL}/auth/login`, input);
        }
        const { data } = response;
        const { data: me } = await apiClient.get<MeResponse>(`${AUTH_API_URL}/auth/me`);
        const claimPending = await discoverLegacyClaim();
        set((state) => ({
          initialized: true,
          setupStatus: authenticatedStatus(state.setupStatus),
          user: data.user,
          activeWorkspace: me.workspace,
          workspaces: me.workspaces,
          legacyClaimPending: !state.legacyClaimAcknowledged && claimPending,
        }));
        rememberActiveWorkspace(me.workspace);
        await rehydrateProjectWorkspace();
      },

      registerInvitation: async (input) => {
        await refreshCsrfToken();
        const { data } = await apiClient.post<AuthResponse>(
          `${AUTH_API_URL}/auth/invitations/register`,
          input,
        );
        const { data: me } = await apiClient.get<MeResponse>(`${AUTH_API_URL}/auth/me`);
        const invitedWorkspace = me.workspaces.find((workspace) => workspace.role === "member") ?? me.workspace;
        set((state) => ({
          initialized: true,
          setupStatus: authenticatedStatus(state.setupStatus),
          user: data.user,
          activeWorkspace: invitedWorkspace,
          workspaces: me.workspaces,
          legacyClaimPending: false,
        }));
        rememberActiveWorkspace(invitedWorkspace);
        await rehydrateProjectWorkspace();
      },

      logout: async () => {
        let requestError: unknown;
        try {
          await apiClient.post(`${AUTH_API_URL}/auth/logout`);
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
        const { data } = await apiClient.get<MeResponse>(`${AUTH_API_URL}/auth/me`);
        const activeWorkspace =
          data.workspaces.find((workspace) => workspace.id === get().activeWorkspace?.id) ?? data.workspace;
        set({ user: data.user, activeWorkspace, workspaces: data.workspaces });
        rememberActiveWorkspace(activeWorkspace);
      },

      setActiveWorkspace: async (workspaceId) => {
        const workspace = get().workspaces.find((item) => item.id === workspaceId);
        if (!workspace || workspace.id === get().activeWorkspace?.id) return;
        rememberActiveWorkspace(workspace);
        set({ activeWorkspace: workspace });
        await rehydrateProjectWorkspace();
        window.location.hash = "#/";
        window.dispatchEvent(new Event("hashchange"));
      },

      createWorkspace: async (name) => {
        const { data } = await apiClient.post<WorkspaceSummary>(
          `${AUTH_API_URL}/auth/workspaces`,
          { name },
        );
        set((state) => ({ workspaces: [...state.workspaces, data] }));
        return data;
      },

      changePassword: async (input) => {
        await apiClient.post(`${AUTH_API_URL}/auth/change-password`, input);
        get().clearSession();
        clearReturnHash();
      },

      getPasswordResetStatus: async () => {
        const { data } = await apiClient.get<PasswordResetStatus>(
          `${AUTH_API_URL}/auth/password-reset/status`,
        );
        return data;
      },

      resetPassword: async (input) => {
        await refreshCsrfToken();
        await apiClient.post(`${AUTH_API_URL}/auth/password-reset`, {
          ...input,
          recovery_token: input.recovery_token?.trim() || undefined,
        });
        get().clearSession();
        clearReturnHash();
      },

      clearSession: () => {
        rememberActiveWorkspace(null);
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem("omni_studio.clientInstanceId");
          // Project state is scoped by user and Workspace; remove all local
          // snapshots on logout so stale private data cannot be rehydrated.
          for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
            const key = window.localStorage.key(index);
            if (key?.startsWith("project-storage:")) window.localStorage.removeItem(key);
          }
        }
        set({
          user: null,
          activeWorkspace: null,
          workspaces: [],
          legacyClaimPending: false,
        });
        void rehydrateProjectWorkspace();
      },
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
        activeWorkspace: state.activeWorkspace,
        workspaces: state.workspaces,
        legacyClaimPending: state.legacyClaimPending,
        legacyClaimAcknowledged: state.legacyClaimAcknowledged,
      }),
    },
  ),
);
