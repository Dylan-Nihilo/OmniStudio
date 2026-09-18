// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProjectClient from "@/components/project/ProjectClient";

const { store, project } = vi.hoisted(() => {
    const project = { id: "episode-1", title: "Lease acceptance", workflow_mode: "r2v", characters: [], frames: [] };
    const store = { currentProject: project, currentSeries: null, selectProject: vi.fn().mockResolvedValue(true),
        pendingExtraction: null as unknown, isAnalyzing: false, confirmExtraction: vi.fn(), discardExtraction: vi.fn() };
    return { store, project };
});

beforeEach(() => {
    store.currentProject = project;
    store.pendingExtraction = null;
    store.confirmExtraction.mockReset().mockResolvedValue(undefined);
    window.location.hash = "";
});

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

vi.mock("@/store/projectStore", () => ({
    useProjectStore: Object.assign((selector: (state: typeof store) => unknown) => selector(store), { getState: () => store }),
}));

vi.mock("@/components/layout/AppShell", () => ({
    default: ({ context, children }: { context: React.ReactNode; children: React.ReactNode }) => (
        <div>
            <nav data-testid="pipeline-navigation">{context}</nav>
            <main data-testid="pipeline-content">{children}</main>
        </div>
    ),
}));
vi.mock("@/components/layout/PipelineSidebar", () => ({
    default: () => <button type="button">Navigate pipeline</button>,
}));
vi.mock("@/components/layout/EpisodeMiniList", () => ({ default: () => null }));
vi.mock("@/components/collaboration/EpisodeEditLeaseGuard", () => ({
    default: ({ children }: { children: React.ReactNode }) => (
        <section data-testid="lease-protected">{children}</section>
    ),
}));

vi.mock("@/components/modules/ScriptProcessor", () => ({
    default: () => <div data-testid="script-workspace">Script workspace</div>,
}));
vi.mock("@/components/modules/Cast", () => ({ default: () => null }));
vi.mock("@/components/modules/VideoGenerator", () => ({ default: () => null }));
vi.mock("@/components/modules/VideoAssembly", () => ({ default: () => null }));
vi.mock("@/components/modules/ConsistencyVault", () => ({ default: () => null }));
vi.mock("@/components/modules/ArtDirection", () => ({ default: () => <div data-testid="style-workspace" /> }));
vi.mock("@/components/modules/StoryboardComposer", () => ({ default: () => null }));
vi.mock("@/components/modules/StoryboardR2V", () => ({ default: () => null }));
vi.mock("@/components/common/ModelSettingsModal", () => ({ default: () => null }));
vi.mock("@/components/project/EnvConfigDialog", () => ({ default: () => null }));
vi.mock("@/components/project/PromptConfigModal", () => ({ default: () => null }));
vi.mock("@/components/modules/EntityConfirmModal", () => ({
    default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) => isOpen ? <button onClick={onConfirm}>Confirm extraction</button> : null,
}));
vi.mock("@omnistudio/ui", () => ({
    ActionMenu: () => null,
    Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
    EmptyState: () => null,
    LoadingState: () => <div>Loading</div>,
}));

describe("ProjectClient edit lease scope", () => {
    it("keeps pipeline navigation outside the lease-protected editor content", async () => {
        render(<ProjectClient id="episode-1" />);

        await waitFor(() => expect(screen.getByTestId("script-workspace")).toBeInTheDocument());
        const guard = screen.getByTestId("lease-protected");

        expect(guard).toContainElement(screen.getByTestId("script-workspace"));
        expect(guard).not.toContainElement(screen.getByTestId("pipeline-navigation"));
    });
});


it("opens style setup only after the extraction has been saved", async () => {
    store.pendingExtraction = {};
    let finish!: () => void;
    store.confirmExtraction.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<ProjectClient id="episode-1" />);
    await screen.findByTestId("script-workspace");
    fireEvent.click(screen.getByRole("button", { name: "Confirm extraction" }));
    expect(screen.queryByTestId("style-workspace")).not.toBeInTheDocument();
    finish();
    await screen.findByTestId("style-workspace");
});

it("does not navigate a different project when extraction finishes late", async () => {
    store.pendingExtraction = {};
    store.confirmExtraction.mockImplementation(async () => { store.currentProject = { ...project, id: "episode-2" }; });
    const navigate = vi.fn();
    document.addEventListener("omni_studio:navigateStep", navigate);
    const view = render(<ProjectClient id="episode-1" />);
    try {
        await screen.findByTestId("script-workspace");
        fireEvent.click(screen.getByRole("button", { name: "Confirm extraction" }));
        await waitFor(() => expect(store.currentProject.id).toBe("episode-2"));
        expect(navigate).not.toHaveBeenCalled();
    } finally {
        document.removeEventListener("omni_studio:navigateStep", navigate);
        view.unmount();
    }
});
