// @vitest-environment happy-dom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ScriptEditorShell from "./ScriptEditorShell";

const editor = {
  state: { doc: { descendants: vi.fn() } },
  commands: { setContent: vi.fn() },
  setEditable: vi.fn(),
  isEmpty: true,
};
const loadDocument = vi.hoisted(() => vi.fn());
const getProject = vi.hoisted(() => vi.fn());
const runDerivation = vi.hoisted(() => vi.fn());
const translate = vi.hoisted(() => (key: string) => key);
const rightPanelProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const viewModeState = vi.hoisted(() => ({ mode: "edit" as "edit" | "storyboard" | "read" | "focus", setMode: vi.fn() }));
const editorStoreMock = vi.hoisted(() => {
  const state = {
    isDirty: false,
    lastSavedAt: null,
    wordCount: 0,
    derivedScenes: [],
    currentFormat: "chinese_short",
    currentRendering: "cjk_zh",
    leftSidebarCollapsed: false,
    rightSidebarCollapsed: false,
    setProjectId: vi.fn(),
    setDirty: vi.fn(),
    setLastSavedAt: vi.fn(),
    setLoading: vi.fn(),
    updateDerivation: vi.fn(),
  };
  const useEditorStore = (selector: (value: typeof state) => unknown) => selector(state);
  useEditorStore.getState = () => state;
  return { state, useEditorStore };
});

vi.mock("next-intl", () => ({
  useTranslations: () => translate,
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: ({ className }: { className: string }) => (
    <div data-testid="editor-content" className={className} />
  ),
}));

vi.mock("@/store/editorStore", () => ({
  useEditorStore: editorStoreMock.useEditorStore,
}));

vi.mock("@/lib/scriptEditorApi", () => ({
  scriptEditorApi: { loadDocument },
}));
vi.mock("@/lib/api", () => ({ api: { getProject } }));

vi.mock("./hooks/useEditorSetup", () => ({
  useEditorSetup: () => ({ editor, isReady: true }),
}));
vi.mock("./hooks/usePasteHandler", () => ({
  usePasteHandler: () => ({ showHint: false, analysis: null, applyFormatting: vi.fn(), dismissHint: vi.fn() }),
}));
vi.mock("./hooks/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: () => ({ showShortcutHelp: false, closeShortcutHelp: vi.fn() }),
}));
vi.mock("./hooks/useContinuityCheck", () => ({ useContinuityCheck: () => null }));
vi.mock("./hooks/useSceneFolding", () => ({
  useSceneFolding: () => ({ enabled: false, isAllExpanded: true, totalScenes: 0 }),
}));
vi.mock("./hooks/useViewMode", () => ({
  useViewMode: () => ({ mode: viewModeState.mode, setMode: viewModeState.setMode, isReadOnly: false, showToolbar: true, showSidebars: true }),
}));
vi.mock("./hooks/useOfflineCache", () => ({
  useOfflineCache: () => ({ hasNewerLocal: false, restoreFromLocal: vi.fn(), dismissLocalRestore: vi.fn(), isOffline: false }),
}));
vi.mock("./hooks/useL3Completion", () => ({ useL3Completion: vi.fn() }));
vi.mock("./hooks/useAutoSave", () => ({
  useAutoSave: () => ({ isSaving: false, saveError: null }),
}));
vi.mock("./hooks/useDerivation", () => ({
  useDerivation: () => ({ runDerivation }),
}));
vi.mock("./toolbar/FormatToolbar", () => ({ default: () => null }));
vi.mock("./components/PasteHintBar", () => ({ PasteHintBar: () => null }));
vi.mock("./components/ShortcutHelpPanel", () => ({ ShortcutHelpPanel: () => null }));
vi.mock("./components/ContinuityIndicator", () => ({ ContinuityIndicator: () => null }));
vi.mock("./panels", () => ({ default: (props: Record<string, unknown>) => {
  rightPanelProps.current = props;
  return null;
} }));
vi.mock("./sidebar", () => ({ default: () => null }));
vi.mock("./views/StoryboardView", () => ({ default: () => null }));

describe("ScriptEditorShell layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadDocument.mockResolvedValue({ type: "doc", content: [] });
    getProject.mockResolvedValue({
      id: "project-1",
      title: "最后一班地铁",
      originalText: "完整原稿",
      characters: [{ id: "c1", name: "林默" }],
      scenes: [{ id: "s1", name: "地铁站", description: "夜" }],
      props: [{ id: "p1", name: "车票", description: "旧车票" }],
      frames: [],
      status: "ready",
    });
    rightPanelProps.current = null;
    viewModeState.mode = "edit";
    viewModeState.setMode.mockClear();
  });

  it("keeps the editor surface and editable content width-constrained", () => {
    render(<ScriptEditorShell mode="full" />);

    expect(document.querySelector(".script-editor")).toHaveClass("w-full", "min-w-0");
    expect(screen.getByTestId("editor-content")).toHaveClass("w-full", "min-w-0");
  });

  it("uses the active theme background for the editor canvas and loading overlay", () => {
    render(<ScriptEditorShell mode="full" projectId="project-1" />);

    const shell = screen.getByTestId("script-editor-shell");
    expect(shell).toHaveClass("bg-background");
    expect(shell).not.toHaveClass("bg-[#050508]");
    expect(screen.getByRole("status")).toHaveClass("bg-overlay");
  });

  it("shows a clear exit control and Escape hint in focus mode", () => {
    viewModeState.mode = "focus";

    render(<ScriptEditorShell mode="full" />);

    expect(screen.getByRole("button", { name: "views.exitFocus" })).toBeVisible();
    expect(screen.getByText("views.exitFocusHint")).toBeVisible();
  });

  it("loads the bound project document without marking it dirty", async () => {
    render(<ScriptEditorShell mode="full" projectId="project-1" />);

    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith("project-1"));
    expect(editor.commands.setContent).toHaveBeenCalledWith(
      { type: "doc", content: [] },
      { emitUpdate: false },
    );
    expect(editor.setEditable).toHaveBeenCalledWith(true);
  });

  it("loads the complete project so panels can show existing assets", async () => {
    render(<ScriptEditorShell mode="full" projectId="project-1" />);

    await waitFor(() => expect(getProject).toHaveBeenCalledWith("project-1"));
    await waitFor(() => expect(rightPanelProps.current?.project).toMatchObject({
      title: "最后一班地铁",
      characters: [{ name: "林默" }],
    }));
  });

  it("uses the canonical original script when a persisted document is clearly truncated", async () => {
    const originalText = "场景1 夜 内 地铁站台\n" + "林默在深夜空荡的站台等待列车。".repeat(12);
    getProject.mockResolvedValue({
      id: "project-1",
      title: "最后一班地铁",
      originalText,
      characters: [], scenes: [], props: [], frames: [], status: "ready",
    });
    loadDocument.mockResolvedValue({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "临时测试" }] }],
    });

    render(<ScriptEditorShell mode="full" projectId="project-1" />);

    await waitFor(() => expect(editor.commands.setContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "doc", content: expect.arrayContaining([
        expect.objectContaining({ type: "sceneHeading", content: [expect.objectContaining({ text: expect.stringContaining("场景1") })] }),
      ]) }),
      { emitUpdate: false },
    ));
  });
});
