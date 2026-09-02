// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import QueuePanel from "./QueuePanel";
import { usePlaygroundStore } from "./usePlaygroundStore";

const { cancelGeneration } = vi.hoisted(() => ({
  cancelGeneration: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
  playgroundApi: { cancelGeneration },
}));

describe("QueuePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelGeneration.mockResolvedValue({
      id: "generation-1",
      mode: "t2i",
      model_id: "model-1",
      prompt: "A running generation",
      input_media: [],
      parameters: {},
      batch_size: 1,
      outputs: [],
      status: "failed",
      error: "Canceled by user",
      created_at: new Date().toISOString(),
    });
    usePlaygroundStore.setState({
      queue: [],
      history: [{
        id: "generation-1",
        mode: "t2i",
        model_id: "model-1",
        prompt: "A running generation",
        input_media: [],
        parameters: {},
        batch_size: 1,
        outputs: [],
        status: "processing",
        created_at: new Date().toISOString(),
      }],
      activeGenerationIds: ["generation-1"],
      maxConcurrent: 1,
    });
  });

  it("shows a cancel action for a running generation", async () => {
    render(<QueuePanel />);
    fireEvent.click(screen.getByTitle("queue.label"));

    const cancelButton = screen.getByTitle("queue.cancelRunning");
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(cancelGeneration).toHaveBeenCalledWith("generation-1");
    });
  });
});
