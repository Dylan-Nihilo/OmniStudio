// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ResultCard from "@/components/modules/playground/ResultCard";
import { apiStreamRequest } from "@/lib/apiClient";
import { playgroundApi } from "@/lib/api";
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
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

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

  it("preserves both results when a batch saves out of order and prevents duplicate saves", async () => {
    const batch = { ...generation, batch_size: 2, outputs: [generation.outputs[0], { ...generation.outputs[0], id: "output-2" }] };
    usePlaygroundStore.setState({ history: [batch] });
    const completions: (() => void)[] = [];
    vi.mocked(playgroundApi.saveToLibrary).mockImplementation(() => new Promise(resolve => {
      completions.push(() => resolve({ ok: true }));
    }));
    function Cards() {
      const current = usePlaygroundStore(state => state.history[0]);
      return <><ResultCard generation={current} /><ResultCard generation={current} outputIndex={1} /></>;
    }
    render(<Cards />);
    const saveButtons = screen.getAllByRole('button', { name: 'card.saveToLibrary' });
    fireEvent.click(saveButtons[0]);
    fireEvent.click(saveButtons[1]);
    expect(saveButtons.every(button => button.hasAttribute('disabled'))).toBe(true);
    expect(playgroundApi.saveToLibrary).toHaveBeenNthCalledWith(1, 'generation-1', 'output-1');
    expect(playgroundApi.saveToLibrary).toHaveBeenNthCalledWith(2, 'generation-1', 'output-2');
    await act(async () => completions[1]());
    await act(async () => completions[0]());
    const savedButtons = screen.getAllByRole('button', { name: 'card.saved' });
    expect(savedButtons).toHaveLength(2);
    for (const button of savedButtons) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(playgroundApi.saveToLibrary).toHaveBeenCalledTimes(2);
    expect(usePlaygroundStore.getState().history[0].outputs.map(output => output.saved_to_library)).toEqual([true, true]);
  });
});
