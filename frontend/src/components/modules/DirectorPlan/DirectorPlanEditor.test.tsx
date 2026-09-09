import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DirectorPlanEditor from "./DirectorPlanEditor";

const api = vi.hoisted(() => ({
  resolve: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  preview: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ directorPlanApi: api }));

const resolved = {
  episode_id: "episode-1",
  plan: {
    tempo: "measured", composition: "natural", lens: "35mm", blocking: "clear",
    lighting: "soft", transition: "cut", sound: "room tone", continuity_rules: [],
  },
  source_chain: {
    tempo: "episode", composition: "project", lens: "system", blocking: "system",
    lighting: "project", transition: "system", sound: "system", continuity_rules: "system",
  },
};

describe("DirectorPlanEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.resolve.mockResolvedValue(resolved);
    api.update.mockResolvedValue({});
    api.remove.mockResolvedValue({ deleted: true });
    api.preview.mockResolvedValue({ preview_id: "preview-1", status: "preview", payload: { ...resolved.plan, tempo: "urgent" } });
    api.confirm.mockResolvedValue({ status: "confirmed" });
  });

  it("renders resolved values with provenance and saves an episode override", async () => {
    render(<DirectorPlanEditor projectId="project-1" episodeId="episode-1" />);
    expect(await screen.findByDisplayValue("measured")).toBeInTheDocument();
    expect(screen.getByLabelText("节奏 · episode")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("节奏 · episode"), { target: { value: "urgent" } });
    fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("episode", "episode-1", expect.objectContaining({ tempo: "urgent" })));
  });

  it("requires an explicit confirmation for AI previews", async () => {
    render(<DirectorPlanEditor projectId="project-1" episodeId="episode-1" />);
    const input = await screen.findByLabelText("AI 计划预览");
    fireEvent.change(input, { target: { value: "紧张的低机位" } });
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(api.preview).toHaveBeenCalledWith("episode", "episode-1", "紧张的低机位"));
    expect(api.confirm).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "确认并应用" }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith("episode", "episode-1", "preview-1"));
  });

  it("uses the selected shot id for shot overrides", async () => {
    render(<DirectorPlanEditor projectId="project-1" episodeId="episode-1" shotId="shot-7" />);
    expect(await screen.findByDisplayValue("measured")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shot 覆盖" }));
    fireEvent.change(screen.getByLabelText("节奏 · episode"), { target: { value: "urgent" } });
    fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("shot", "shot-7", expect.objectContaining({ episode_id: "episode-1" })));
  });
});
