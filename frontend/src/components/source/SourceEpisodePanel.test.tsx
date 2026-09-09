import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SourceEpisode } from "@/lib/api";
import SourceEpisodePanel from "./SourceEpisodePanel";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const linkedEpisode = (overrides: Partial<SourceEpisode> = {}): SourceEpisode => ({
  id: "episode-linked",
  project_id: "project-1",
  title: "第一集：夜行",
  episode_number: 1,
  status: "draft",
  linked_at: 1_700_000_000,
  ...overrides,
});

const availableEpisode = (overrides: Partial<SourceEpisode> = {}): SourceEpisode => ({
  id: "episode-available",
  project_id: "project-1",
  title: "第二集：回声",
  episode_number: 2,
  status: "draft",
  linked_at: 0,
  ...overrides,
});

describe("SourceEpisodePanel", () => {
  it("展示已关联剧集和可选剧集", () => {
    render(
      <SourceEpisodePanel
        linkedEpisodes={[linkedEpisode()]}
        availableEpisodes={[availableEpisode()]}
        onLink={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "episodeLinks" })).toBeInTheDocument();
    expect(screen.getByText("第一集：夜行")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /episodeToLink/ })).toHaveTextContent("第二集：回声");
    expect(screen.getByRole("button", { name: "unlinkEpisode" })).toBeEnabled();
  });

  it("选择可选剧集后触发关联回调", async () => {
    const onLink = vi.fn().mockResolvedValue(undefined);
    render(
      <SourceEpisodePanel
        linkedEpisodes={[]}
        availableEpisodes={[availableEpisode()]}
        onLink={onLink}
        onUnlink={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /episodeToLink/ }));
    fireEvent.click(await screen.findByRole("option", { name: /第二集：回声/ }));
    fireEvent.click(screen.getByRole("button", { name: "linkEpisode" }));

    await waitFor(() => expect(onLink).toHaveBeenCalledWith("episode-available"));
  });

  it("点击解除关联后传递剧集 id", async () => {
    const onUnlink = vi.fn().mockResolvedValue(undefined);
    render(
      <SourceEpisodePanel
        linkedEpisodes={[linkedEpisode()]}
        availableEpisodes={[]}
        onLink={vi.fn()}
        onUnlink={onUnlink}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "unlinkEpisode" }));

    await waitFor(() => expect(onUnlink).toHaveBeenCalledWith("episode-linked"));
  });

  it("点击已关联 Episode 后打开对应剧本", () => {
    const onOpenScript = vi.fn();
    render(
      <SourceEpisodePanel
        linkedEpisodes={[linkedEpisode()]}
        availableEpisodes={[]}
        onLink={vi.fn()}
        onUnlink={vi.fn()}
        onOpenScript={onOpenScript}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "open scriptEditor" }));

    expect(onOpenScript).toHaveBeenCalledWith("episode-linked");
  });

  it("没有关系时显示空态并隐藏关联操作", () => {
    render(
      <SourceEpisodePanel
        linkedEpisodes={[]}
        availableEpisodes={[]}
        onLink={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );

    expect(screen.getByText("noLinkedEpisodes")).toBeInTheDocument();
    expect(screen.getByText("noAvailableEpisodes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "linkEpisode" })).not.toBeInTheDocument();
  });

  it("busy 时阻止关系操作", () => {
    const onLink = vi.fn();
    const onUnlink = vi.fn();
    render(
      <SourceEpisodePanel
        linkedEpisodes={[linkedEpisode()]}
        availableEpisodes={[availableEpisode()]}
        busy
        onLink={onLink}
        onUnlink={onUnlink}
      />,
    );

    expect(screen.getByRole("button", { name: "linkEpisode" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "unlinkEpisode" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "unlinkEpisode" }));
    expect(onUnlink).not.toHaveBeenCalled();
  });
});
