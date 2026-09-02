// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
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
vi.mock("@/components/modules/playground/ResultCard", () => ({ default: () => null }));

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
});
