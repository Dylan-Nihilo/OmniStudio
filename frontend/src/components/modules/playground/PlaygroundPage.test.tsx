// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlaygroundPage from "./PlaygroundPage";
import { usePlaygroundStore } from "./usePlaygroundStore";
import { useToastStore } from "@/store/toastStore";

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    useToastStore.setState({ toasts: [] });
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

  it("shows an error toast when the generation request cannot be dispatched", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    generate.mockRejectedValue(new Error("provider unavailable"));
    usePlaygroundStore.setState({ prompt: "A cinematic portrait" });

    render(<PlaygroundPage />);
    fireEvent.click(screen.getByRole("button", { name: "compose.generate" }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "error", body: "provider unavailable" }),
        ]),
      );
    });
  });

});
