// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PlaygroundPage from "./PlaygroundPage";
import { usePlaygroundStore } from "./usePlaygroundStore";

const { getHistory, getTemplates, generate, getGeneration, getGenerationStatus } = vi.hoisted(() => ({
  getHistory: vi.fn(),
  getTemplates: vi.fn(),
  generate: vi.fn(),
  getGeneration: vi.fn(),
  getGenerationStatus: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
  playgroundApi: {
    getHistory,
    getTemplates,
    generate,
    getGeneration,
    getGenerationStatus,
  },
}));

vi.mock("./ModeSelector", () => ({ default: () => null }));
vi.mock("./ModelSelector", () => ({ default: () => null }));
vi.mock("./MediaInput", () => ({ default: () => null }));
vi.mock("./PromptInput", () => ({ default: () => null }));
vi.mock("./ParameterBar", () => ({ default: () => null }));
vi.mock("./ResultGallery", () => ({ default: () => null }));

describe("PlaygroundPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHistory.mockResolvedValue([]);
    getTemplates.mockResolvedValue([]);
    usePlaygroundStore.setState({
      mode: "t2i",
      modelId: "image-model",
      prompt: "",
      negativePrompt: "",
      inputMedia: [],
      parameters: {},
      batchSize: 1,
      history: [],
      queue: [],
      activeGenerationIds: [],
      maxConcurrent: 1,
    });
  });

  it("disables generation for i2i until a reference image is provided", () => {
    usePlaygroundStore.setState({
      mode: "i2i",
      prompt: "A cinematic portrait",
      inputMedia: [],
    });

    render(<PlaygroundPage />);

    expect(screen.getByRole("button", { name: "compose.generate" })).toBeDisabled();
  });

});
