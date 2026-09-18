import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/renderWithIntl";
import DirectorPlanEditor from "./DirectorPlanEditor";

const api = vi.hoisted(() => ({ get: vi.fn(), resolve: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/api", () => ({ directorPlanApi: api }));
const plan = {
  tempo: "balanced", composition: "natural", lens: "35mm", blocking: "clear subject separation",
  lighting: "motivated soft light", transition: "cut", sound: "diegetic room tone", continuity_rules: [],
};
const resolved = { episode_id: "episode-1", plan, source_chain: { tempo: "episode", composition: "project" } };

function open(props = {}) {
  const view = renderWithIntl(<DirectorPlanEditor projectId="episode-1" {...props} />);
  fireEvent.click(screen.getByText("镜头与声音"));
  return view;
}

describe("camera and sound creative notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.resolve.mockResolvedValue(resolved);
    api.get.mockResolvedValue({ payload: {} });
    api.update.mockResolvedValue({});
    api.remove.mockResolvedValue({ deleted: true });
  });

  it("starts collapsed, offers Chinese choices, and saves only the changed field", async () => {
    const view = renderWithIntl(<DirectorPlanEditor projectId="episode-1" />);
    expect(screen.getByText("镜头与声音").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("镜头与声音"));
    expect(await screen.findByRole("radio", { name: "节奏适中" })).toBeChecked();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/暂不自动加入生成/)).toBeVisible();
    expect(screen.queryByText("AI 计划预览")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "紧张利落" }));
    fireEvent.click(screen.getByRole("button", { name: "保存创作备忘" }));
    await screen.findByText("创作备忘已保存");
    expect(api.update).toHaveBeenCalledWith("episode", "episode-1", { tempo: "urgent" });
    view.unmount();
  });

  it("preserves existing custom text and validates new custom choices", async () => {
    api.resolve.mockResolvedValue({ ...resolved, plan: { ...plan, lighting: "雨夜的侧逆光" } });
    open();
    expect(await screen.findByRole("textbox", { name: "自定义光线氛围" })).toHaveValue("雨夜的侧逆光");
    fireEvent.click(within(screen.getByRole("group", { name: "叙事节奏" })).getByRole("radio", { name: "自定义" }));
    const input = screen.getByRole("textbox", { name: "自定义叙事节奏" });
    expect(input).toHaveAttribute("maxlength", "120");
    expect(screen.getByRole("button", { name: "保存创作备忘" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "见到旧伤时停顿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存创作备忘" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("episode", "episode-1", { tempo: "见到旧伤时停顿" }));
  });

  it("retains selections after failed save and allows retry", async () => {
    api.update.mockRejectedValueOnce(new Error("offline"));
    open();
    fireEvent.click(await screen.findByRole("radio", { name: "冷色夜景" }));
    fireEvent.click(screen.getByRole("button", { name: "保存创作备忘" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("当前修改仍在");
    expect(screen.getByRole("radio", { name: "冷色夜景" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保存创作备忘" }));
    await screen.findByText("创作备忘已保存");
    expect(api.update).toHaveBeenCalledTimes(2);
  });

  it("saves the selected shot and reads episode choices when switching scope", async () => {
    open({ shotId: "shot-7" });
    fireEvent.click(await screen.findByRole("radio", { name: "紧张利落" }));
    expect(screen.getByRole("button", { name: "本集通用" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存创作备忘" }));
    await screen.findByText("创作备忘已保存");
    expect(api.update).toHaveBeenCalledWith("shot", "shot-7", { tempo: "urgent", episode_id: "episode-1" });
    fireEvent.click(screen.getByRole("button", { name: "本集通用" }));
    await waitFor(() => expect(api.resolve).toHaveBeenLastCalledWith("episode-1", undefined));
    expect(await screen.findByRole("radio", { name: "节奏适中" })).toBeChecked();
  });

  it("restores inherited choices and does not allow edits after a failed load", async () => {
    api.resolve.mockRejectedValueOnce(new Error("offline"));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("请重试后再编辑");
    expect(screen.queryByRole("button", { name: "保存创作备忘" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    fireEvent.click(await screen.findByRole("button", { name: "恢复继承设置" }));
    await screen.findByText(/已恢复上一级设置/);
    expect(api.remove).toHaveBeenCalledWith("episode", "episode-1", undefined);
  });
});
