// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ScriptEditorShell from "./ScriptEditorShell";

const editor = {
  state: { doc: { descendants: vi.fn() } },
  commands: { setContent: vi.fn() },
  setEditable: vi.fn(),
  getJSON: () => ({ type: "doc", content: [] }),
  isEmpty: true,
};
const saveDocument = vi.hoisted(() => vi.fn());
const loadDocument = vi.hoisted(() => vi.fn());
const importDocument = vi.hoisted(() => vi.fn());
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
  scriptEditorApi: { loadDocument, importDocument },
}));
vi.mock("@/lib/api", () => ({ api: { getProject } }));

vi.mock("./hooks/useEditorSetup", () => ({
  useEditorSetup: () => ({ editor, isReady: true }),
}));
vi.mock("./hooks/usePasteHandler", () => ({
  usePasteHandler: () => ({ showHint: false, analysis: null, applyFormatting: vi.fn(), dismissHint: vi.fn() }),
}));
vi.mock("./hooks/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: () => ({ showShortcutHelp: false, closeShortcutHelp: vi.fn(), toggleShortcutHelp: vi.fn() }),
}));
vi.mock("./hooks/useContinuityCheck", () => ({ useContinuityCheck: () => null }));
vi.mock("./hooks/useSceneFolding", () => ({
  useSceneFolding: () => ({ enabled: false, isAllExpanded: true, totalScenes: 0 }),
}));
vi.mock("./hooks/useViewMode", () => ({
  useViewMode: () => ({ mode: viewModeState.mode, setMode: viewModeState.setMode, isReadOnly: viewModeState.mode === 'read', showToolbar: viewModeState.mode !== 'read', showSidebars: viewModeState.mode === 'edit' }),
}));
vi.mock("./hooks/useOfflineCache", () => ({
  useOfflineCache: () => ({ hasNewerLocal: false, restoreFromLocal: vi.fn(), dismissLocalRestore: vi.fn(), isOffline: false }),
}));
vi.mock("./hooks/useL3Completion", () => ({ useL3Completion: vi.fn() }));
vi.mock("./hooks/useAutoSave", () => ({
  useAutoSave: () => ({ save: saveDocument, isSaving: false, saveError: null }),
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
vi.mock("./sidebar", () => ({ default: ({tab}: {tab: string}) => <div>{tab}</div> }));
vi.mock("./views/StoryboardView", () => ({ default: () => null }));

describe("ScriptEditorShell layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editorStoreMock.state.isDirty = false;
    saveDocument.mockResolvedValue(true);
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
    expect(editor.setEditable).toHaveBeenCalledWith(true, false);
  });

  it("shows the upstream Source stale state when a loaded document is out of date", async () => {
    loadDocument.mockResolvedValue({
      content: { type: "doc", content: [] },
      revision: "script-revision-1",
      dependency_fingerprint: "current-fingerprint",
      source_dependencies: [{
        source_id: "source-1",
        source_title: "原始资料",
        chapter_id: "chapter-1",
        chapter_title: "第一章",
        revision_id: "source-revision-2",
        revision_number: 2,
      }],
      stale: true,
      stale_targets: [{ target_type: "script", target_stage: "script", target_id: "project-1" }],
      updated_at: "2026-09-09T00:00:00Z",
    });

    render(<ScriptEditorShell mode="full" projectId="project-1" />);

    expect(await screen.findByTestId("script-source-stale")).toHaveTextContent("source.staleBanner");
    expect(screen.getByTestId("script-source-stale")).toHaveTextContent("原始资料");
    expect(screen.getByTestId("script-source-stale")).toHaveTextContent("第一章");
  });

  it("loads the complete project so panels can show existing assets", async () => {
    render(<ScriptEditorShell mode="full" projectId="project-1" />);

    await waitFor(() => expect(getProject).toHaveBeenCalledWith("project-1"));
    fireEvent.click(screen.getByRole('button', { name: 'shell.inspector' }));
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
  it('offers a return from reading and disables editor mutations', async () => {
    viewModeState.mode = 'read';
    render(<ScriptEditorShell projectId="project-1" />);
    await waitFor(() => expect(loadDocument).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'views.edit' }));
    expect(viewModeState.setMode).toHaveBeenCalledWith('edit');
    expect(editor.setEditable).toHaveBeenLastCalledWith(false, false);
  });

  it('imports through the actions menu and marks the parsed document unsaved', async () => {
    const content = { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'Imported draft' }] }] };
    importDocument.mockResolvedValue({ content });
    render(<ScriptEditorShell projectId="project-1" />);
    await waitFor(() => expect(editor.setEditable).toHaveBeenCalledWith(true, false));
    fireEvent.click(screen.getByRole('button', { name: 'toolbar.actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'dialogs.import.title' }));
    expect(screen.getByRole('dialog', { name: 'dialogs.import.title' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('dialogs.import.chooseFile', { selector: 'input' }), { target: { files: [new File(['Draft'], 'draft.txt')] } });
    expect(importDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'dialogs.import.title' }));
    await waitFor(() => expect(editor.commands.setContent).toHaveBeenLastCalledWith(content, { emitUpdate: true }));
    expect(editorStoreMock.state.setDirty).toHaveBeenLastCalledWith(true);
  });

  it("opens the search panel on a narrow viewport from the keyboard command", async () => {
    render(<ScriptEditorShell projectId="project-1" />);
    await waitFor(() => expect(editorStoreMock.state.setLoading).toHaveBeenCalledWith(false));
    act(() => document.dispatchEvent(new CustomEvent('script-editor:focus-search')));
    expect(screen.getByRole('dialog', {name: 'shell.outline'})).toHaveTextContent('search');
    expect(viewModeState.setMode).toHaveBeenCalledWith('edit');
  });

  it("only switches a dirty project after a successful save", async () => {
    const changeProject = vi.fn();
    editorStoreMock.state.isDirty = true;
    saveDocument.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<ScriptEditorShell projectId="project-1" onChangeProject={changeProject} />);
    await waitFor(() => expect(editorStoreMock.state.setLoading).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByRole('button', {name:'shell.changeProject'}));
    fireEvent.click(screen.getByRole('button', {name:'shell.saveAndLeave'}));
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    expect(changeProject).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', {name:'shell.unsavedTitle'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'shell.saveAndLeave'}));
    await waitFor(() => expect(changeProject).toHaveBeenCalledOnce());
  });

});
