import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/renderWithIntl";
import type { SourceEpisodeSplitPreview } from "@/lib/api";

import SourceEpisodeSplitPanel from "./SourceEpisodeSplitPanel";

const preview: SourceEpisodeSplitPreview = {
  id: "split-preview-1",
  workspace_id: "workspace-1",
  source_document_id: "source-1",
  title: "雨夜故事",
  content_sha256: "a".repeat(64),
  suggested_episodes: 2,
  proposals: [
    {
      episode_number: 1,
      title: "夜班开始",
      summary: "林夏在末班地铁值守。",
      start_marker: "第1章",
      end_marker: "第2章",
      estimated_duration: "08:00",
    },
    {
      episode_number: 2,
      title: "站台回声",
      summary: "站台出现无法解释的回声。",
      start_marker: "第3章",
      end_marker: "结尾",
      estimated_duration: "09:00",
    },
  ],
  status: "previewing",
  series_id: null,
  episode_ids: [],
  created_at: 1,
  updated_at: 1,
};

describe("SourceEpisodeSplitPanel", () => {
  it("requests an AI split preview with the suggested episode count", () => {
    const onPreview = vi.fn();
    renderWithIntl(
      <SourceEpisodeSplitPanel
        preview={null}
        busy={false}
        createdEpisodes={[]}
        onPreview={onPreview}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "建议集数" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "生成拆集预览" }));

    expect(onPreview).toHaveBeenCalledWith(3);
  });

  it("edits a proposal and exposes save, cancel, and confirm actions", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderWithIntl(
      <SourceEpisodeSplitPanel
        preview={preview}
        busy={false}
        createdEpisodes={[]}
        onPreview={vi.fn()}
        onChange={onChange}
        onSave={onSave}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "第 1 集标题" }), { target: { value: "夜班与失踪" } });
    expect(onChange).toHaveBeenCalledWith([
      { ...preview.proposals[0], title: "夜班与失踪" },
      preview.proposals[1],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "保存拆集预览" }));
    fireEvent.click(screen.getByRole("button", { name: "取消拆集预览" }));
    fireEvent.change(screen.getByRole("textbox", { name: "剧集标题" }), { target: { value: "零点信号" } });
    fireEvent.change(screen.getByRole("textbox", { name: "剧集描述" }), { target: { value: "一季短剧" } });
    fireEvent.click(screen.getByRole("button", { name: "确认创建 Episode" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ title: "零点信号", description: "一季短剧" });
  });

  it("renders created episodes after confirmation", () => {
    renderWithIntl(
      <SourceEpisodeSplitPanel
        preview={{ ...preview, status: "confirmed", episode_ids: ["episode-1", "episode-2"] }}
        busy={false}
        createdEpisodes={[
          { id: "episode-1", title: "夜班开始", episode_number: 1, text_length: 120 },
          { id: "episode-2", title: "站台回声", episode_number: 2, text_length: 130 },
        ]}
        onPreview={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("已创建 2 个 Episode")).toBeVisible();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("夜班开始");
  });
});
