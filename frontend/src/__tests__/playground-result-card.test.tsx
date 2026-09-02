// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ResultCard from "@/components/modules/playground/ResultCard";
import { apiStreamRequest } from "@/lib/apiClient";
import { usePlaygroundStore, type PlaygroundGeneration } from "@/components/modules/playground/usePlaygroundStore";

const getAssetUrl = vi.hoisted(() => vi.fn((path: string) => `/api-proxy/files/${path}`));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/utils", () => ({ getAssetUrl }));
vi.mock("@/lib/api", () => ({
  playgroundApi: { saveToLibrary: vi.fn() },
}));
vi.mock("@/lib/apiClient", () => ({
  apiStreamRequest: vi.fn(),
}));

const generation: PlaygroundGeneration = {
  id: "generation-1",
  mode: "t2v",
  model_id: "happyhorse-1.1-t2v",
  prompt: "A paper crane flies through a midnight station",
  input_media: [],
  parameters: { duration: 5 },
  batch_size: 1,
  outputs: [{
    id: "output-1",
    media_path: "output/playground/videos/workspace-1/t2v-generation-1_0.mp4",
    media_type: "video",
    saved_to_library: false,
  }],
  status: "completed",
  created_at: "2026-09-02T01:00:00.000Z",
};

describe("ResultCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaygroundStore.setState({ featuredByGen: {} });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:download"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("renders a playable video for completed video output", () => {
    render(<ResultCard generation={generation} />);

    const video = screen.getByTestId("playground-result-video");
    expect(video).toHaveAttribute(
      "src",
      "/api-proxy/files/playground/videos/workspace-1/t2v-generation-1_0.mp4",
    );
    expect(video).toHaveAttribute("controls");
  });

  it("downloads completed media through the authenticated stream client", async () => {
    vi.mocked(apiStreamRequest).mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(["video"])),
    } as unknown as Response);

    render(<ResultCard generation={generation} />);
    fireEvent.click(screen.getByTitle("card.download"));

    await waitFor(() => {
      expect(apiStreamRequest).toHaveBeenCalledWith(
        "/api-proxy/files/playground/videos/workspace-1/t2v-generation-1_0.mp4",
      );
    });
  });
});
