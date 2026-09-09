// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    vi.useRealTimers();
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

  it("blocks excess references after a model switch without discarding the user's inputs", async () => {
    const media = Array.from({ length: 6 }, (_, index) => `reference-${index}.png`);
    usePlaygroundStore.setState({ mode: "r2v", modelId: "wan2.7-r2v", prompt: "A station", inputMedia: media });
    render(<PlaygroundPage />);
    await waitFor(() => expect(getHistory).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "compose.generate" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("media.tooManyReferences");
    expect(usePlaygroundStore.getState().inputMedia).toEqual(media);
    act(() => usePlaygroundStore.getState().setModelId("happyhorse-1.1-r2v"));
    await waitFor(() => expect(screen.getByRole("button", { name: "compose.generate" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(usePlaygroundStore.getState().inputMedia).toEqual(media);
    expect(generate).not.toHaveBeenCalled();
  });

  it("shows an error toast when the generation request cannot be dispatched", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    generate.mockRejectedValue(new Error("provider unavailable"));
    usePlaygroundStore.setState({ prompt: "A cinematic portrait" });

    render(<PlaygroundPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "compose.generate" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "compose.generate" }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "error", body: "provider unavailable" }),
        ]),
      );
    });
  });

  it("shows history loading and allows retry after a failed read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let rejectRead!: (error: Error) => void;
    getHistory.mockImplementationOnce(() => new Promise((_, reject) => { rejectRead = reject; }));
    usePlaygroundStore.setState({ prompt: "A cinematic portrait" });
    render(<PlaygroundPage />);
    expect(screen.getByRole("status")).toHaveTextContent("results.loading");
    expect(screen.getByRole("button", { name: "compose.generate" })).toBeDisabled();
    rejectRead(new Error("offline"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("results.loadFailed"));
    fireEvent.click(screen.getByRole("button", { name: "card.retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(getHistory).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "compose.generate" })).not.toBeDisabled();
  });

  it("resumes running history, retries a read failure, and ignores a response after cancellation", async () => {
    const running = { id: "restored", mode: "t2i", model_id: "image-model", prompt: "Sea", input_media: [], parameters: {}, batch_size: 1, outputs: [], status: "processing", created_at: new Date().toISOString() };
    getHistory.mockResolvedValue([running]);
    getGeneration.mockRejectedValueOnce(new Error("offline"));
    vi.useFakeTimers();
    await act(async () => { render(<PlaygroundPage />); });
    expect(usePlaygroundStore.getState().activeGenerationIds).toEqual(["restored"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole("alert")).toHaveTextContent("results.pollFailed");
    let finishRead!: (value: unknown) => void;
    getGeneration.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(getGeneration).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(getGeneration).toHaveBeenCalledTimes(2);
    act(() => usePlaygroundStore.getState().updateGeneration({ ...usePlaygroundStore.getState().history[0], status: "failed", error: "Canceled" }));
    await act(async () => { finishRead(running); });
    expect(usePlaygroundStore.getState().history[0].status).toBe("failed");
    expect(usePlaygroundStore.getState().activeGenerationIds).toEqual([]);
  });

  it("releases concurrency when a submitted generation is already terminal", async () => {
    let sequence = 0;
    generate.mockImplementation(async () => ({ id: `done-${++sequence}`, status: "completed", mode: "t2i", outputs: [] }));
    usePlaygroundStore.setState({ prompt: "Sea" });
    render(<PlaygroundPage />);
    const button = screen.getByRole("button", { name: "compose.generate" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(usePlaygroundStore.getState().history).toHaveLength(1));
    fireEvent.click(button);
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(usePlaygroundStore.getState().activeGenerationIds).toEqual([]);
    expect(usePlaygroundStore.getState().isGenerating).toBe(false);
  });

});
