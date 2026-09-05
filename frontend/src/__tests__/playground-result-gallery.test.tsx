// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ResultGallery from "@/components/modules/playground/ResultGallery";
import { usePlaygroundStore } from "@/components/modules/playground/usePlaygroundStore";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/lib/api", () => ({
  playgroundApi: {
    generate: vi.fn(),
    getGenerationStatus: vi.fn(),
    getGeneration: vi.fn(),
    deleteGeneration: vi.fn(),
  },
}));

vi.mock("@/components/modules/playground/GalleryView", () => ({ default: () => null }));
vi.mock("@/components/modules/playground/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/modules/playground/ResultCard", () => ({ default: ({ generation, onRetry }: any) => <button onClick={() => onRetry(generation)}>retry-result</button> }));

describe("ResultGallery", () => {
  beforeEach(() => {
    usePlaygroundStore.setState({
      history: [],
      queue: [{
        id: "q1",
        mode: "t2i",
        modelId: "model-1",
        prompt: "A test image",
        inputMedia: [],
        parameters: {},
        batchSize: 1,
        status: "dispatching",
        enqueuedAt: Date.now(),
      }],
    });
  });

  it("shows queued generation feedback when the gallery has no history", () => {
    render(<ResultGallery />);

    expect(screen.getByTitle("queue.label")).toBeInTheDocument();
    expect(screen.getByText("queue.label")).toBeInTheDocument();
    expect(screen.getByText("· 1")).toBeInTheDocument();
  });
  it("queues retries with the original generation inputs", () => {
    usePlaygroundStore.setState({ queue: [], history: [{ id: "failed", mode: "i2v", model_id: "video-model", prompt: "Camera moves", negative_prompt: "blur", input_media: ["frame.png"], parameters: { duration: 5 }, batch_size: 4, status: "failed", outputs: [], created_at: new Date().toISOString() }] });
    render(<ResultGallery />);
    fireEvent.click(screen.getByRole("button", { name: "retry-result" }));
    expect(usePlaygroundStore.getState().queue).toEqual([expect.objectContaining({ mode: "i2v", modelId: "video-model", prompt: "Camera moves", negativePrompt: "blur", inputMedia: ["frame.png"], parameters: { duration: 5 }, batchSize: 4, status: "pending" })]);
  });

});
