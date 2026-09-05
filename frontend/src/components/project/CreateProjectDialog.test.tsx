import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useProjectStore } from "@/store/projectStore";
import CreateProjectDialog from "./CreateProjectDialog";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

it("labels project controls, validates the title and closes with Escape", async () => {
  const close = vi.fn();
  render(<CreateProjectDialog isOpen onClose={close} />);
  const dialog = screen.getByRole("dialog", { name: "createTitle" });
  const title = screen.getByRole("textbox", { name: "projectTitle" });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.change(title, { target: { value: "   " } });
  expect(screen.getByRole("button", { name: "createProject" })).toBeDisabled();
  screen.getByRole("button", { name: "close" }).focus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});

it("retains script input after failure and passes the original creation contract on retry", async () => {
  const original = useProjectStore.getState().createProject;
  const create = vi.fn().mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce(undefined);
  useProjectStore.setState({ createProject: create, currentProject: { id: "episode", series_id: "series" } as never });
  const close = vi.fn();
  try {
    render(<CreateProjectDialog isOpen onClose={close} seriesId="series" seriesTitle="Story" />);
    const title = screen.getByRole("textbox", { name: "projectTitle" });
    const script = screen.getByRole("textbox", { name: "scriptContent" });
    fireEvent.change(title, { target: { value: "  Opening  " } });
    fireEvent.change(script, { target: { value: "A signal crosses the city." } });
    fireEvent.click(screen.getByRole("button", { name: "createProject" }));
    await screen.findByRole("alert");
    expect(title).toHaveValue("  Opening  ");
    expect(script).toHaveValue("A signal crosses the city.");
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "createProject" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(create).toHaveBeenLastCalledWith("Opening", "A signal crosses the city.", true, "r2v", "series");
    expect(window.location.hash).toBe("#/series/series/episode/episode");
  } finally {
    useProjectStore.setState({ createProject: original, currentProject: null });
  }
});

it("validates uploaded scripts and loads supported text files without submitting them", async () => {
  render(<CreateProjectDialog isOpen onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "uploadScript" }));
  const input = screen.getByLabelText("scriptFileRequirements");
  fireEvent.change(input, { target: { files: [new File(["image"], "cover.png")] } });
  expect(screen.getByRole("alert")).toHaveTextContent("scriptFileRequirements");
  const file = new File(["Opening scene"], "Night.md");
  Object.defineProperty(file, "text", { value: () => Promise.resolve("Opening scene") });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "scriptContent" })).toHaveValue("Opening scene"));
  expect(screen.getByRole("textbox", { name: "projectTitle" })).toHaveValue("Night");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
