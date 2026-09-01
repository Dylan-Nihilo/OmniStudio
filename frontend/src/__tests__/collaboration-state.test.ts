/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { post, patch, deleteRequest } = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  deleteRequest: vi.fn(),
}));

vi.mock("@/lib/apiClient", () => ({
  API_URL: "/api-proxy",
  CLIENT_INSTANCE_KEY: "omni_studio.clientInstanceId",
  apiClient: { post, patch, delete: deleteRequest },
}));

import { useEditLeaseStore } from "@/store/editLeaseStore";
import { scopedProjectStorageKey } from "@/store/projectStore";

describe("collaboration client state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useEditLeaseStore.setState({
      status: "idle",
      scriptId: null,
      token: null,
      revision: null,
      holderDisplayName: null,
    });
  });

  it("namespaces persisted project state by user and Workspace", () => {
    localStorage.setItem(
      "omni_studio-auth",
      JSON.stringify({ state: { user: { id: "user-1" } } }),
    );
    localStorage.setItem("omni_studio.activeWorkspaceId", "workspace-2");

    expect(scopedProjectStorageKey("project-storage")).toBe(
      "project-storage:user-1:workspace-2",
    );
  });

  it("turns a held Episode lease into a named read-only state", async () => {
    post.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 423,
        data: {
          lease: {
            holder_display_name: "邵霖",
            revision: "revision-a",
          },
        },
      },
    });

    await useEditLeaseStore.getState().acquire("episode-1");

    expect(useEditLeaseStore.getState()).toMatchObject({
      status: "locked",
      scriptId: "episode-1",
      holderDisplayName: "邵霖",
      revision: "revision-a",
      token: null,
    });
  });

  it("deduplicates StrictMode lease acquisition for the same Episode", async () => {
    let resolveRequest!: (value: { data: Record<string, unknown> }) => void;
    post.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));

    const first = useEditLeaseStore.getState().acquire("episode-1");
    await useEditLeaseStore.getState().release();
    const second = useEditLeaseStore.getState().acquire("episode-1");
    resolveRequest({
      data: {
        script_id: "episode-1",
        holder_user_id: "user-1",
        holder_display_name: "Dylan",
        client_instance_id: "browser-1",
        expires_at: 100,
        revision: "revision-a",
        token: "lease-token",
      },
    });
    await Promise.all([first, second]);

    expect(post).toHaveBeenCalledTimes(1);
    expect(useEditLeaseStore.getState()).toMatchObject({
      status: "editing",
      scriptId: "episode-1",
      token: "lease-token",
    });
  });
});
