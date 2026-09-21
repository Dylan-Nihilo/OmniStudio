import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/renderWithIntl";
import type { SourceAnalysisBatch, SourceChapterAnalysis } from "@/lib/api";
import SourceAnalysisPanel from "./SourceAnalysisPanel";
import SourceChapterPanel from "./SourceChapterPanel";

const mocks = vi.hoisted(() => ({ getChapterAnalysis: vi.fn(), listChapterAnalysisHistory: vi.fn() }));
vi.mock("@/lib/api", () => ({ sourceApi: mocks }));

const analysis: SourceChapterAnalysis = {
  id: "analysis-1", workspace_id: "workspace-1", source_document_id: "source-1",
  chapter_id: "chapter-1", chapter_number: 1, chapter_title: "潮声来信",
  revision_id: "revision-1", revision_number: 1, content_sha256: "hash",
  status: "succeeded", events: [{ sequence: 1, event_type: "revelation",
    description: "顾潮生从录音中得知母亲仍活着。", characters: ["顾潮生", "顾岚"],
    location: "废弃观测站", importance: "high", source_excerpt: "别让他们打开第七闸门。" }],
  error_code: null, error_message: null, attempt: 1, retry_of: null,
  created_at: 1, updated_at: 1, finished_at: 1, reused: false,
};

function batch(reused = false): SourceAnalysisBatch {
  return {
    id: "batch-1", workspace_id: "workspace-1", source_document_id: "source-1",
    status: reused ? "skipped" : "succeeded", total: 1, succeeded: reused ? 0 : 1,
    failed: 0, skipped: reused ? 1 : 0, created_at: 1, updated_at: 1,
    success_items: [], failed_items: [], skipped_items: [],
    items: [{ id: "item-1", batch_id: "batch-1", chapter_id: "chapter-1", chapter_number: 1,
      chapter_title: "潮声来信", status: reused ? "skipped" : "succeeded", analysis_id: "analysis-1",
      attempt: 1, error_code: null, error_message: null, skip_reason: reused ? "already_analyzed" : null,
      created_at: 1, updated_at: 1 }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getChapterAnalysis.mockResolvedValue(analysis);
});

describe("source analysis results", () => {
  it("opens saved results from chapter details without a batch and warns about changed text", async () => {
    const chapter = { id: "chapter-1", source_document_id: "source-1", chapter_number: 1,
      title: "潮声来信", current_revision_id: "revision-2", revision_count: 2, created_at: 1, updated_at: 2,
      current_revision: { id: "revision-2", source_document_id: "source-1", chapter_id: "chapter-1",
        revision_number: 2, content: "更新后的正文", content_sha256: "updated-hash",
        created_by_user_id: null, metadata: {}, created_at: 2 },
    };
    renderWithIntl(<SourceChapterPanel chapters={[chapter]} total={1} page={1} pageSize={20} query=""
      selectedChapter={chapter} revisions={[]} impacts={[]} onQueryChange={vi.fn()} onPageChange={vi.fn()}
      onSelect={vi.fn()} onSave={vi.fn()} onRestore={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /查看分析结果/ }));
    expect(await screen.findByText(analysis.events[0].description)).toBeVisible();
    expect(screen.getByText(/正文已更新，以下结果基于旧版本/)).toBeVisible();
    expect(screen.getByText("基于正文版本 1 · 提取 1 个事件")).toBeVisible();
  });

  it("distinguishes an analysis with no extracted events from a failed load", async () => {
    mocks.getChapterAnalysis.mockResolvedValue({ ...analysis, events: [] });
    renderWithIntl(<SourceAnalysisPanel chapters={[]} batch={batch()} onAnalyze={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /查看分析结果/ }));
    expect(await screen.findByText("分析已完成，但未提取到事件。")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an explicit unavailable state if there is no saved analysis", async () => {
    mocks.getChapterAnalysis.mockRejectedValue({ response: { status: 404 } });
    renderWithIntl(<SourceAnalysisPanel chapters={[]} batch={batch()} onAnalyze={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /查看分析结果/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂无可查看的分析结果");
    expect(screen.queryByText(analysis.events[0].description)).not.toBeInTheDocument();
  });

  it.each([false, true])("shows saved event details for a completed batch (reused=%s)", async reused => {
    renderWithIntl(<SourceAnalysisPanel chapters={[]} batch={batch(reused)} onAnalyze={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /查看分析结果/ }));
    expect(await screen.findByText(analysis.events[0].description)).toBeVisible();
    expect(screen.getByText("顾潮生、顾岚")).toBeVisible();
    expect(screen.getByText("废弃观测站")).toBeVisible();
    expect(screen.getByText("高")).toBeVisible();
    expect(screen.getByText("别让他们打开第七闸门。")).toBeVisible();
    expect(screen.queryByText("already_analyzed")).not.toBeInTheDocument();
    if (reused) expect(screen.getByText("已分析，复用已有结果")).toBeVisible();
  });

  it("uses the batch's saved analysis when a newer analysis exists", async () => {
    mocks.getChapterAnalysis.mockResolvedValue({ ...analysis, id: "analysis-new", events: [] });
    mocks.listChapterAnalysisHistory.mockResolvedValue({ items: [analysis], total: 1 });
    renderWithIntl(<SourceAnalysisPanel chapters={[]} batch={batch()} onAnalyze={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /查看分析结果/ }));
    expect(await screen.findByText(analysis.events[0].description)).toBeVisible();
  });

  it("allows retrying a failed result fetch without re-running analysis", async () => {
    const onAnalyze = vi.fn();
    mocks.getChapterAnalysis.mockRejectedValueOnce(new Error("offline"));
    renderWithIntl(<SourceAnalysisPanel chapters={[]} batch={batch()} onAnalyze={onAnalyze} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /查看分析结果/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("分析结果加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重新加载结果" }));
    expect(await screen.findByText(analysis.events[0].description)).toBeVisible();
    expect(onAnalyze).not.toHaveBeenCalled();
  });
});
