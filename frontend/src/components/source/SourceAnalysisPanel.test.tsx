import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SourceAnalysisBatch, SourceChapter } from "@/lib/api";
import SourceAnalysisPanel from "./SourceAnalysisPanel";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const chapters: SourceChapter[] = [
  {
    id: "chapter-1",
    source_document_id: "source-1",
    chapter_number: 1,
    title: "夜班开始",
    current_revision_id: "revision-1",
    revision_count: 1,
    current_revision: {
      id: "revision-1",
      source_document_id: "source-1",
      chapter_id: "chapter-1",
      revision_number: 1,
      content: "林夏走进站台。",
      content_sha256: "a".repeat(64),
      created_at: 1,
      created_by_user_id: null,
      metadata: {},
    },
    created_at: 1,
    updated_at: 1,
  },
  {
    id: "chapter-2",
    source_document_id: "source-1",
    chapter_number: 2,
    title: "站台回声",
    current_revision_id: "revision-2",
    revision_count: 1,
    current_revision: {
      id: "revision-2",
      source_document_id: "source-1",
      chapter_id: "chapter-2",
      revision_number: 1,
      content: "广播突然响起。",
      content_sha256: "b".repeat(64),
      created_at: 1,
      created_by_user_id: null,
      metadata: {},
    },
    created_at: 1,
    updated_at: 1,
  },
];

const item = (overrides: Partial<SourceAnalysisBatch["items"][number]> = {}) => ({
  id: "item-1",
  batch_id: "batch-1",
  chapter_id: "chapter-1",
  chapter_number: 1,
  chapter_title: "夜班开始",
  status: "succeeded" as const,
  analysis_id: "analysis-1",
  attempt: 1,
  error_code: null,
  error_message: null,
  skip_reason: null,
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

const batch = (overrides: Partial<SourceAnalysisBatch> = {}): SourceAnalysisBatch => ({
  id: "batch-1",
  workspace_id: "workspace-1",
  source_document_id: "source-1",
  status: "partially_succeeded",
  total: 3,
  succeeded: 1,
  failed: 1,
  skipped: 1,
  items: [
    item(),
    item({
      id: "item-2",
      chapter_id: "chapter-2",
      chapter_number: 2,
      chapter_title: "站台回声",
      status: "failed",
      analysis_id: null,
      error_code: "MODEL_TIMEOUT",
      error_message: "模型响应超时",
    }),
    item({
      id: "item-3",
      chapter_id: "chapter-3",
      chapter_number: 3,
      chapter_title: "尾声",
      status: "skipped",
      analysis_id: null,
      skip_reason: "当前版本已有可复用分析",
    }),
  ],
  success_items: [item()],
  failed_items: [
    item({
      id: "item-2",
      chapter_id: "chapter-2",
      chapter_number: 2,
      chapter_title: "站台回声",
      status: "failed",
      analysis_id: null,
      error_code: "MODEL_TIMEOUT",
      error_message: "模型响应超时",
    }),
  ],
  skipped_items: [
    item({
      id: "item-3",
      chapter_id: "chapter-3",
      chapter_number: 3,
      chapter_title: "尾声",
      status: "skipped",
      analysis_id: null,
      skip_reason: "当前版本已有可复用分析",
    }),
  ],
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

describe("SourceAnalysisPanel", () => {
  it("renders each batch item with status, error details, and skip reason", () => {
    render(
      <SourceAnalysisPanel
        chapters={chapters}
        batch={batch()}
        onAnalyze={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("夜班开始")).toBeVisible();
    expect(screen.getByText("站台回声")).toBeVisible();
    expect(screen.getByText("尾声")).toBeVisible();
    expect(screen.getByText("MODEL_TIMEOUT")).toBeVisible();
    expect(screen.getByText("模型响应超时")).toBeVisible();
    expect(screen.getByText("当前版本已有可复用分析")).toBeVisible();
    expect(screen.getAllByText("succeeded").length).toBeGreaterThan(0);
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("skipped").length).toBeGreaterThan(0);
  });

  it("retries one failed item with its chapter id and keeps bulk retry", () => {
    const onRetry = vi.fn();
    render(
      <SourceAnalysisPanel
        chapters={chapters}
        batch={batch()}
        onAnalyze={vi.fn()}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "retryFailed" }));
    expect(onRetry).toHaveBeenCalledWith();

    fireEvent.click(screen.getByRole("button", { name: /retryFailed.*站台回声/ }));
    expect(onRetry).toHaveBeenCalledWith(["chapter-2"]);
  });

  it("uses the batch item list even when grouped arrays are empty", () => {
    const current = batch({
      success_items: [],
      failed_items: [],
      skipped_items: [],
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      items: [item()],
    });
    render(
      <SourceAnalysisPanel
        chapters={chapters}
        batch={current}
        onAnalyze={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("夜班开始")).toBeVisible();
    expect(screen.queryByRole("button", { name: /retryFailed.*夜班开始/ })).not.toBeInTheDocument();
  });
});
