import axios from "axios";
import { create } from "zustand";
import { apiClient, API_URL, CLIENT_INSTANCE_KEY } from "@/lib/apiClient";
import { createUuid } from "@/lib/id";

type LeaseStatus = "idle" | "acquiring" | "editing" | "locked" | "lost";

interface LeasePayload {
  script_id: string;
  holder_user_id: string;
  holder_display_name: string;
  client_instance_id: string;
  expires_at: number;
  revision: string;
  token: string | null;
}

interface EditLeaseStore {
  status: LeaseStatus;
  scriptId: string | null;
  token: string | null;
  revision: string | null;
  holderDisplayName: string | null;
  holderUserId: string | null;
  clientInstanceId: string;
  /** `takeover` reclaims a lease this user already holds in another window. */
  acquire: (scriptId: string, loadedRevision?: string, takeover?: boolean) => Promise<void>;
  heartbeat: () => Promise<void>;
  release: () => Promise<void>;
  setRevision: (revision: string) => void;
}

const clientInstanceId =
  typeof window === "undefined"
    ? "server"
    : window.sessionStorage.getItem(CLIENT_INSTANCE_KEY) || createUuid();

if (typeof window !== "undefined") {
  window.sessionStorage.setItem(CLIENT_INSTANCE_KEY, clientInstanceId);
}

const acquireRequests = new Map<string, Promise<LeasePayload>>();
let acquisitionVersion = 0;

const requestLease = (scriptId: string, clientId: string, takeover: boolean): Promise<LeasePayload> => {
  const key = takeover ? `${scriptId}:takeover` : scriptId;
  const existing = acquireRequests.get(key);
  if (existing) return existing;
  const request = apiClient.post<LeasePayload>(
    `${API_URL}/projects/${scriptId}/edit-lease`,
    { client_instance_id: clientId, takeover },
  ).then((response) => response.data).finally(() => acquireRequests.delete(key));
  acquireRequests.set(key, request);
  return request;
};

export const useEditLeaseStore = create<EditLeaseStore>((set, get) => ({
  status: "idle",
  scriptId: null,
  token: null,
  revision: null,
  holderDisplayName: null,
  holderUserId: null,
  clientInstanceId,

  acquire: async (scriptId, loadedRevision, takeover = false) => {
    const version = ++acquisitionVersion;
    // Reacquiring edit access must not rebase a local draft onto unseen changes.
    const revision = (get().scriptId === scriptId ? get().revision : null) ?? loadedRevision ?? null;
    set({ status: "acquiring", scriptId, token: null, revision, holderDisplayName: null, holderUserId: null });
    try {
      const data = await requestLease(scriptId, get().clientInstanceId, takeover);
      if (version !== acquisitionVersion) {
        if (get().scriptId !== scriptId && data.token) {
          void apiClient.delete(`${API_URL}/projects/${scriptId}/edit-lease`, {
            data: { client_instance_id: get().clientInstanceId },
            headers: { "X-Edit-Lease": data.token },
          });
        }
        return;
      }
      set({
        status: "editing",
        scriptId,
        token: data.token,
        revision: revision ?? data.revision,
        holderDisplayName: data.holder_display_name,
        holderUserId: data.holder_user_id,
      });
    } catch (error) {
      if (version !== acquisitionVersion) return;
      if (axios.isAxiosError(error) && error.response?.status === 423) {
        const lease = (error.response.data as { lease?: LeasePayload }).lease;
        set({
          status: "locked",
          scriptId,
          token: null,
          revision: revision ?? lease?.revision ?? null,
          holderDisplayName: lease?.holder_display_name ?? "其他成员",
          holderUserId: lease?.holder_user_id ?? null,
        });
        return;
      }
      set({ status: "lost", token: null });
      throw error;
    }
  },

  heartbeat: async () => {
    const { scriptId, token, clientInstanceId } = get();
    if (!scriptId || !token) return;
    try {
      await apiClient.patch(
        `${API_URL}/projects/${scriptId}/edit-lease`,
        { client_instance_id: clientInstanceId },
        { headers: { "X-Edit-Lease": token } },
      );
    } catch {
      if (get().scriptId === scriptId && get().token === token) {
        set({ status: "lost", token: null });
      }
    }
  },

  release: async () => {
    acquisitionVersion += 1;
    const { scriptId, token, clientInstanceId } = get();
    set({ status: "idle", scriptId: null, token: null, revision: null, holderDisplayName: null, holderUserId: null });
    if (!scriptId || !token) return;
    try {
      await apiClient.delete(`${API_URL}/projects/${scriptId}/edit-lease`, {
        data: { client_instance_id: clientInstanceId },
        headers: { "X-Edit-Lease": token },
      });
    } catch {
      // The 90-second TTL safely releases a lease if navigation happens offline.
    }
  },

  setRevision: (revision) => set({ revision }),
}));
