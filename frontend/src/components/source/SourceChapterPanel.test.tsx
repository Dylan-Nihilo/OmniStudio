import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SourceChapter, SourceRevisionImpact } from "@/lib/api";
import SourceChapterPanel from "./SourceChapterPanel";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const chapter: SourceChapter = {
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
    content: "林默走进车厢。",
    content_sha256: "a".repeat(64),
    created_by_user_id: "user-1",
    metadata: {},
    created_at: 2,
  },
  created_at: 1,
  updated_at: 2,
};

const impact: SourceRevisionImpact = {
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
    target_type: "script",
    target_id: "episode-1",
    episode_id: "episode-1",
    target_stage: "script",
    status: "needs_review",
    metadata: {},
    created_at: 2,
  }],
  created_by_user_id: "user-1",
  created_at: 2,
};

describe("SourceChapterPanel", () => {
  it("从章节下游影响目标打开对应剧本", () => {
    const onOpenScript = vi.fn();
    render(
      <SourceChapterPanel
        chapters={[chapter]}
        total={1}
        page={1}
        pageSize={20}
        query=""
        selectedChapter={chapter}
        revisions={[chapter.current_revision!]}
        impacts={[impact]}
        onQueryChange={vi.fn()}
        onPageChange={vi.fn()}
        onSelect={vi.fn()}
        onSave={vi.fn()}
        onRestore={vi.fn()}
        onClose={vi.fn()}
        onOpenScript={onOpenScript}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "open scriptEditor" }));

    expect(onOpenScript).toHaveBeenCalledWith("episode-1");
  });
});
