import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import CreateProjectDialog from "./CreateProjectDialog";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

it("labels the project dialog, keeps keyboard focus inside and closes with Escape", () => {
  const close = vi.fn();
  render(<CreateProjectDialog isOpen onClose={close} />);
  const dialog = screen.getByRole("dialog", { name: "createTitle" });
  const title = screen.getByRole("textbox", { name: "projectTitle" });
  expect(title).toHaveFocus();
  fireEvent.change(title, { target: { value: "   " } });
  expect(screen.getByRole("button", { name: "createProject" })).toBeDisabled();
  screen.getByRole("button", { name: "close" }).focus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});
