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
  clientInstanceId: string;
  acquire: (scriptId: string) => Promise<void>;
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

const requestLease = (scriptId: string, clientId: string): Promise<LeasePayload> => {
  const existing = acquireRequests.get(scriptId);
  if (existing) return existing;
  const request = apiClient.post<LeasePayload>(
    `${API_URL}/projects/${scriptId}/edit-lease`,
    { client_instance_id: clientId },
  ).then((response) => response.data).finally(() => acquireRequests.delete(scriptId));
  acquireRequests.set(scriptId, request);
  return request;
};

export const useEditLeaseStore = create<EditLeaseStore>((set, get) => ({
  status: "idle",
  scriptId: null,
  token: null,
  revision: null,
  holderDisplayName: null,
  clientInstanceId,

  acquire: async (scriptId) => {
    const version = ++acquisitionVersion;
    set({ status: "acquiring", scriptId, token: null, holderDisplayName: null });
    try {
      const data = await requestLease(scriptId, get().clientInstanceId);
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
        revision: data.revision,
        holderDisplayName: data.holder_display_name,
      });
    } catch (error) {
      if (version !== acquisitionVersion) return;
      if (axios.isAxiosError(error) && error.response?.status === 423) {
        const lease = (error.response.data as { lease?: LeasePayload }).lease;
        set({
          status: "locked",
          scriptId,
          token: null,
          revision: lease?.revision ?? null,
          holderDisplayName: lease?.holder_display_name ?? "其他成员",
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
      set({ status: "lost", token: null });
    }
  },

  release: async () => {
    acquisitionVersion += 1;
    const { scriptId, token, clientInstanceId } = get();
    set({ status: "idle", scriptId: null, token: null, revision: null, holderDisplayName: null });
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
