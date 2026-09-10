// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProjectClient from "@/components/project/ProjectClient";

const project = {
    id: "episode-1",
    title: "Lease acceptance",
    workflow_mode: "r2v",
    characters: [],
    frames: [],
};

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: (state: unknown) => unknown) => selector({
        currentProject: project,
        selectProject: vi.fn().mockResolvedValue(true),
        pendingExtraction: null,
        isAnalyzing: false,
        confirmExtraction: vi.fn(),
        discardExtraction: vi.fn(),
    }),
}));

vi.mock("@/lib/pipelineSteps", () => ({
    buildLocalizedPipelineSteps: () => [{ id: "script", label: "Script" }],
    resolveActivePipelineStep: (active: string) => active,
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
vi.mock("@/components/modules/ArtDirection", () => ({ default: () => null }));
vi.mock("@/components/modules/StoryboardComposer", () => ({ default: () => null }));
vi.mock("@/components/modules/StoryboardR2V", () => ({ default: () => null }));
vi.mock("@/components/common/ModelSettingsModal", () => ({ default: () => null }));
vi.mock("@/components/project/EnvConfigDialog", () => ({ default: () => null }));
vi.mock("@/components/project/PromptConfigModal", () => ({ default: () => null }));
vi.mock("@/components/modules/EntityConfirmModal", () => ({ default: () => null }));
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
