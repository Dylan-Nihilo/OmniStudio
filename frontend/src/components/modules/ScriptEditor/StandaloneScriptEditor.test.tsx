// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StandaloneScriptEditor from "./StandaloneScriptEditor";

const mocks = vi.hoisted(() => ({
  getProjects: vi.fn(),
  setProjects: vi.fn(),
  createProject: vi.fn(),
  project: {
    id: "project-1",
    title: "第一集",
    scenes: [],
    characters: [],
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
  api: { getProjects: mocks.getProjects },
}));

vi.mock("@/store/projectStore", () => ({
  useProjectStore: (selector: (state: unknown) => unknown) => selector({
    projects: [mocks.project],
    currentProject: null,
    setProjects: mocks.setProjects,
    createProject: mocks.createProject,
  }),
}));

vi.mock("./ScriptEditorShell", () => ({
  default: (props: { projectId?: string }) => (
    <div data-testid="bound-script-editor">bound:{props.projectId}</div>
  ),
}));

describe("StandaloneScriptEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getProjects.mockResolvedValue([mocks.project]);
    mocks.createProject.mockResolvedValue(undefined);
  });

  it("offers a project picker instead of showing an unusable empty editor", async () => {
    render(<StandaloneScriptEditor />);

    await waitFor(() => expect(mocks.getProjects).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "shell.title" })).toBeVisible();
    expect(document.body.textContent).toContain("standalone.selectProject");
  });

  it("binds the editor to the selected project", async () => {
    render(<StandaloneScriptEditor />);

    const projectButton = await screen.findByRole("button", { name: /第一集/ });
    fireEvent.click(projectButton);

    expect(await screen.findByTestId("bound-script-editor")).toHaveTextContent("bound:project-1");
  });

  it("reopens the most recently selected project after the route remounts", async () => {
    localStorage.setItem("omni_studio.script-editor.last-project", "project-1");

    render(<StandaloneScriptEditor />);

    expect(await screen.findByTestId("bound-script-editor")).toHaveTextContent("bound:project-1");
  });

  it("labels the project controls and requires a non-empty title", async () => {
    render(<StandaloneScriptEditor />);
    const input = await screen.findByRole('textbox', { name: 'standalone.projectTitle' });
    const createButton = screen.getByRole('button', { name: 'standalone.createAndOpen' });
    expect(createButton).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(createButton).toBeDisabled();
    fireEvent.change(input, { target: { value: '下一集' } });
    expect(createButton).toBeEnabled();
    const search = screen.getByRole('searchbox', { name: 'standalone.searchProjects' });
    fireEvent.change(search, { target: { value: 'missing' } });
    expect(screen.getByText('standalone.noMatchingProjects')).toBeVisible();
  });
});
