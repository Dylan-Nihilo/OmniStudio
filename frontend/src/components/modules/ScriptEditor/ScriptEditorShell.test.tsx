// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ScriptEditorShell from "./ScriptEditorShell";

const editor = { state: { doc: { descendants: vi.fn() } }, commands: {} };
const editorState = {
  isDirty: false,
  lastSavedAt: null,
  wordCount: 0,
  derivedScenes: [],
  currentFormat: "chinese_short",
  currentRendering: "cjk_zh",
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: ({ className }: { className: string }) => (
    <div data-testid="editor-content" className={className} />
  ),
}));

vi.mock("@/store/editorStore", () => ({
  useEditorStore: (selector: (state: typeof editorState) => unknown) => selector(editorState),
}));

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
  useViewMode: () => ({ mode: "edit", setMode: vi.fn(), isReadOnly: false, showToolbar: true, showSidebars: true }),
}));
vi.mock("./hooks/useOfflineCache", () => ({
  useOfflineCache: () => ({ hasNewerLocal: false, restoreFromLocal: vi.fn(), dismissLocalRestore: vi.fn(), isOffline: false }),
}));
vi.mock("./hooks/useL3Completion", () => ({ useL3Completion: vi.fn() }));
vi.mock("./toolbar/FormatToolbar", () => ({ default: () => null }));
vi.mock("./components/PasteHintBar", () => ({ PasteHintBar: () => null }));
vi.mock("./components/ShortcutHelpPanel", () => ({ ShortcutHelpPanel: () => null }));
vi.mock("./components/ContinuityIndicator", () => ({ ContinuityIndicator: () => null }));
vi.mock("./panels", () => ({ default: () => null }));
vi.mock("./sidebar", () => ({ default: () => null }));
vi.mock("./views/StoryboardView", () => ({ default: () => null }));

describe("ScriptEditorShell layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the editor surface and editable content width-constrained", () => {
    render(<ScriptEditorShell mode="full" />);

    expect(document.querySelector(".script-editor")).toHaveClass("w-full", "min-w-0");
    expect(screen.getByTestId("editor-content")).toHaveClass("w-full", "min-w-0");
  });
});
