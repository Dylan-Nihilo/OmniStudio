import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/renderWithIntl";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  previewImport: vi.fn(),
  updateImportBoundaries: vi.fn(),
  confirmImport: vi.fn(),
  cancelImport: vi.fn(),
  get: vi.fn(),
  listChapters: vi.fn(),
  listRevisions: vi.fn(),
  restoreRevision: vi.fn(),
  createRevision: vi.fn(),
  listRevisionImpacts: vi.fn(),
  listChapterRevisionImpacts: vi.fn(),
  previewEpisodeSplit: vi.fn(),
  updateEpisodeSplitPreview: vi.fn(),
  cancelEpisodeSplitPreview: vi.fn(),
  confirmEpisodeSplit: vi.fn(),
  listEpisodeCandidates: vi.fn(),
  linkEpisode: vi.fn(),
  unlinkEpisode: vi.fn(),
  remove: vi.fn(),
  acknowledgeRevisionImpact: vi.fn(),
  analyzeSourceBatch: vi.fn(),
  retrySourceAnalysisBatch: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ sourceApi: mocks }));
vi.mock("@/components/layout/AppShell", () => ({
  default: ({ children, context }: { children: React.ReactNode; context?: React.ReactNode }) => <>{context}{children}</>,
}));

import SourceWorkspace from "./SourceWorkspace";

const preview = {
  id: "preview-1",
  workspace_id: "workspace-1",
  source_type: "txt" as const,
  title: "雨夜故事",
  original_filename: "story.txt",
  encoding: "utf-8",
  content: "第1章 初见\n她推门而入。\n第2章 冲突\n两人对峙。",
  summary: "2 个章节",
  content_sha256: "a".repeat(64),
  proposals: [
    { chapter_number: 1, title: "初见", volume: "", start_line: 1, end_line: 2, content: "第1章 初见\n她推门而入。" },
    { chapter_number: 2, title: "冲突", volume: "", start_line: 3, end_line: 4, content: "第2章 冲突\n两人对峙。" },
  ],
  status: "previewing" as const,
  source_document_id: null,
  created_at: 1,
  updated_at: 1,
};

const source = {
  id: "source-1",
  workspace_id: "workspace-1",
  title: "既有来源",
  source_type: "txt" as const,
  original_filename: "old.txt",
  encoding: "utf-8",
  summary: "旧资料",
  metadata: {},
  imported_at: 1,
  chapter_count: 1,
  linked_episode_count: 0,
  created_at: 1,
  updated_at: 1,
};

const chapter = {
  id: "chapter-1",
  source_document_id: "source-1",
  chapter_number: 1,
  title: "初见",
  current_revision_id: "revision-2",
  revision_count: 2,
  current_revision: {
    id: "revision-2",
    source_document_id: "source-1",
    chapter_id: "chapter-1",
    revision_number: 2,
    content: "修订后的正文",
    content_sha256: "b".repeat(64),
    created_by_user_id: "user-1",
    metadata: {},
    created_at: 2,
  },
  created_at: 1,
  updated_at: 2,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({ items: [source], total: 1 });
  mocks.get.mockResolvedValue({ ...source, chapters: [chapter], episodes: [] });
  mocks.listChapters.mockResolvedValue({ items: [chapter], total: 1, page: 1, page_size: 20 });
  mocks.listRevisions.mockResolvedValue({ items: [chapter.current_revision], total: 1 });
  mocks.listRevisionImpacts.mockResolvedValue({ items: [], total: 0 });
  mocks.listChapterRevisionImpacts.mockResolvedValue({ items: [], total: 0 });
  mocks.listEpisodeCandidates.mockResolvedValue({ linked: [], available: [] });
});

describe("SourceWorkspace", () => {
  it("shows source import preview and does not confirm until a preview exists", async () => {
    renderWithIntl(<SourceWorkspace />);

    expect(await screen.findByRole("heading", { name: "来源资料" })).toBeVisible();
    expect(screen.getByRole("button", { name: "确认导入" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "来源标题" }), { target: { value: "雨夜故事" } });
    fireEvent.change(screen.getByRole("textbox", { name: "正文" }), { target: { value: preview.content } });
    mocks.previewImport.mockResolvedValue(preview);
    fireEvent.click(screen.getByRole("button", { name: "生成导入预览" }));

    await waitFor(() => expect(mocks.previewImport).toHaveBeenCalledWith({
      title: "雨夜故事",
      source_type: "paste",
      content: preview.content,
    }));
    expect(await screen.findByText("导入预览")).toBeVisible();
    expect(screen.getByText("初见")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认导入" })).toBeEnabled();
  });

  it("persists edited chapter boundaries before confirming the import", async () => {
    mocks.previewImport.mockResolvedValue(preview);
    mocks.updateImportBoundaries.mockResolvedValue({ ...preview, proposals: [{ ...preview.proposals[0], title: "雨夜初见" }, preview.proposals[1]] });
    mocks.confirmImport.mockResolvedValue({ preview_id: preview.id, status: "confirmed", source_document: source });
    renderWithIntl(<SourceWorkspace />);
    fireEvent.change(screen.getByRole("textbox", { name: "来源标题" }), { target: { value: "雨夜故事" } });
    fireEvent.change(screen.getByRole("textbox", { name: "正文" }), { target: { value: preview.content } });
    fireEvent.click(screen.getByRole("button", { name: "生成导入预览" }));
    await screen.findByText("导入预览");

    const firstChapter = screen.getByRole("article", { name: /第 1 章/ });
    fireEvent.change(within(firstChapter).getByRole("textbox", { name: "章节标题" }), { target: { value: "雨夜初见" } });
    fireEvent.change(within(firstChapter).getByRole("spinbutton", { name: "起始行" }), { target: { value: "2" } });
    fireEvent.change(within(firstChapter).getByRole("spinbutton", { name: "结束行" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存章节边界" }));
    await waitFor(() => expect(mocks.updateImportBoundaries).toHaveBeenCalledWith(preview.id, [
      { ...preview.proposals[0], title: "雨夜初见", start_line: 2, end_line: 3 },
      preview.proposals[1],
    ]));
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await waitFor(() => expect(mocks.confirmImport).toHaveBeenCalledWith(preview.id));
    expect(await screen.findByText("来源已导入")).toBeVisible();
  });

  it("edits a chapter and restores a revision from the history panel", async () => {
    const revisions = {
      items: [
        chapter.current_revision,
        { ...chapter.current_revision, id: "revision-1", revision_number: 1, content: "初始正文" },
      ],
      total: 2,
    };
    mocks.listRevisions.mockResolvedValue(revisions);
    mocks.listChapterRevisionImpacts.mockResolvedValue({
      items: [{
        id: "impact-1",
        workspace_id: "workspace-1",
        source_document_id: "source-1",
        chapter_id: "chapter-1",
        revision_id: "revision-2",
        previous_revision_id: "revision-1",
        revision_number: 2,
        previous_revision_number: 1,
        change_type: "chapter_edit",
        status: "open",
        target_count: 1,
        targets: [{
          id: "target-1",
          impact_event_id: "impact-1",
          target_type: "shot",
          target_id: "shot-1",
          episode_id: "episode-1",
          target_stage: "storyboard",
          status: "needs_review",
          metadata: {},
          created_at: 2,
        }],
        created_by_user_id: "user-1",
        created_at: 2,
      }],
      total: 1,
    });
    mocks.restoreRevision.mockResolvedValue({ ...chapter.current_revision, revision_number: 3, content: "初始正文" });
    mocks.get.mockResolvedValue({ ...source, chapters: [chapter], episodes: [] });
    renderWithIntl(<SourceWorkspace />);
    await screen.findByRole("heading", { name: "既有来源" });
    fireEvent.click(await screen.findByRole("button", { name: "初见" }));
    expect(await screen.findByRole("heading", { name: "章节 · 初见" })).toBeVisible();
    expect(await screen.findByText("shot")).toBeVisible();
    expect(screen.getByText(/阶段 storyboard/)).toBeVisible();
    expect(screen.getByText(/状态 needs_review/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "版本历史" }));
    expect(await screen.findByText("版本 1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "恢复版本 1" }));
    await waitFor(() => expect(mocks.restoreRevision).toHaveBeenCalledWith("source-1", "chapter-1", "revision-1"));
  });

  it("previews, edits, and confirms AI episode splitting through source APIs", async () => {
    const splitPreview = {
      id: "split-preview-1",
      workspace_id: "workspace-1",
      source_document_id: "source-1",
      title: "既有来源",
      content_sha256: "c".repeat(64),
      suggested_episodes: 2,
      proposals: [
        { episode_number: 1, title: "第一集", summary: "开端", start_marker: "第1章", end_marker: "第2章", estimated_duration: "08:00" },
        { episode_number: 2, title: "第二集", summary: "冲突", start_marker: "第3章", end_marker: "结尾", estimated_duration: "09:00" },
      ],
      status: "previewing" as const,
      series_id: null,
      episode_ids: [],
      created_at: 1,
      updated_at: 1,
    };
    mocks.previewEpisodeSplit.mockResolvedValue(splitPreview);
    mocks.updateEpisodeSplitPreview.mockResolvedValue({ ...splitPreview, proposals: [{ ...splitPreview.proposals[0], title: "第一集·夜班" }, splitPreview.proposals[1]] });
    mocks.confirmEpisodeSplit.mockResolvedValue({ preview_id: splitPreview.id, status: "confirmed", source_document_id: "source-1", series_id: "series-1", episode_ids: ["episode-1", "episode-2"], episodes: [{ id: "episode-1", title: "第一集·夜班", episode_number: 1, text_length: 100 }, { id: "episode-2", title: "第二集", episode_number: 2, text_length: 110 }] });

    renderWithIntl(<SourceWorkspace />);
    await screen.findByRole("heading", { name: "既有来源" });
    fireEvent.change(screen.getByRole("spinbutton", { name: "建议集数" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "生成拆集预览" }));
    await waitFor(() => expect(mocks.previewEpisodeSplit).toHaveBeenCalledWith("source-1", { suggested_episodes: 2 }));
    expect(await screen.findByText("Episode 拆分预览")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 集标题" }), { target: { value: "第一集·夜班" } });
    fireEvent.click(screen.getByRole("button", { name: "保存拆集预览" }));
    await waitFor(() => expect(mocks.updateEpisodeSplitPreview).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox", { name: "剧集标题" }), { target: { value: "零点信号" } });
    mocks.get.mockClear();
    mocks.listEpisodeCandidates.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "确认创建 Episode" }));
    await waitFor(() => expect(mocks.confirmEpisodeSplit).toHaveBeenCalledWith("split-preview-1", { title: "零点信号", description: "" }));
    expect(await screen.findByText("已创建 2 个 Episode")).toBeVisible();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("source-1"));
    await waitFor(() => expect(mocks.listEpisodeCandidates).toHaveBeenCalledWith("source-1"));
  });

  it("loads source episode links and links an available episode", async () => {
    mocks.listEpisodeCandidates.mockResolvedValue({
      linked: [],
      available: [{ id: "episode-2", project_id: "project-2", title: "第二集：回声", episode_number: 2, status: "draft", linked_at: 0 }],
    });
    mocks.linkEpisode.mockResolvedValue({ source_document_id: "source-1", episode_id: "episode-2", created: true, linked: true });
    renderWithIntl(<SourceWorkspace />);

    expect(await screen.findByRole("heading", { name: "Episode 关联" })).toBeVisible();
    expect(screen.getByRole("button", { name: "关联 Episode" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "关联 Episode" }));

    await waitFor(() => expect(mocks.linkEpisode).toHaveBeenCalledWith("source-1", "episode-2"));
  });

  it("passes a failed chapter id when retrying one analysis item", async () => {
    const failedBatch = {
      id: "batch-1",
      workspace_id: "workspace-1",
      source_document_id: "source-1",
      status: "failed" as const,
      total: 1,
      succeeded: 0,
      failed: 1,
      skipped: 0,
      items: [{
        id: "item-1",
        batch_id: "batch-1",
        chapter_id: "chapter-1",
        chapter_number: 1,
        chapter_title: "初见",
        status: "failed" as const,
        analysis_id: null,
        attempt: 1,
        error_code: "MODEL_TIMEOUT",
        error_message: "模型响应超时",
        skip_reason: null,
        created_at: 1,
        updated_at: 1,
      }],
      success_items: [],
      failed_items: [],
      skipped_items: [],
      created_at: 1,
      updated_at: 1,
    };
    mocks.analyzeSourceBatch.mockResolvedValue(failedBatch);
    mocks.retrySourceAnalysisBatch.mockResolvedValue(failedBatch);
    renderWithIntl(<SourceWorkspace />);
    await screen.findByRole("heading", { name: "既有来源" });
    fireEvent.click(screen.getByRole("button", { name: "分析全部章节" }));
    await screen.findByText("MODEL_TIMEOUT");
    fireEvent.click(screen.getByRole("button", { name: /重试失败项 初见/ }));

    await waitFor(() => expect(mocks.retrySourceAnalysisBatch).toHaveBeenCalledWith("source-1", "batch-1", { chapter_ids: ["chapter-1"] }));
  });

  it("deletes the selected source and refreshes the source list", async () => {
    mocks.list.mockResolvedValueOnce({ items: [source], total: 1 }).mockResolvedValueOnce({ items: [], total: 0 });
    mocks.remove.mockResolvedValue({ id: "source-1", deleted: true });
    renderWithIntl(<SourceWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /既有来源/ }));
    fireEvent.click(await screen.findByRole("button", { name: "删除来源" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("source-1"));
    expect(mocks.remove).toHaveBeenCalledWith("source-1");
  });
});
