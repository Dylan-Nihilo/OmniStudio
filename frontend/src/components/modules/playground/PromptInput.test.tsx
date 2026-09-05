// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PromptInput from "./PromptInput";
import { usePlaygroundStore } from "./usePlaygroundStore";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./PromptTemplateModal", () => ({ default: () => null }));
vi.mock("./PromptHistoryDrawer", () => ({ default: () => null }));

describe("PromptInput", () => {
  beforeEach(() => {
    usePlaygroundStore.setState({ prompt: "", negativePrompt: "" });
  });

  it("keeps the original prompt limit and writes edits to the generation draft", () => {
    render(<PromptInput />);
    const input = screen.getByRole("textbox", { name: "compose.promptLabel" });
    expect(input).toHaveAttribute("maxlength", "2000");
    fireEvent.change(input, { target: { value: "a".repeat(2001) } });
    expect(usePlaygroundStore.getState().prompt).toHaveLength(2000);
  });

  it("keeps negative prompt edits while its advanced section is collapsed", () => {
    render(<PromptInput />);
    const summary = document.querySelector("summary")!;
    fireEvent.click(summary);
    const input = screen.getByLabelText("prompt.negativeLabel");
    fireEvent.change(input, { target: { value: "blurry" } });
    fireEvent.click(summary);
    expect(usePlaygroundStore.getState().negativePrompt).toBe("blurry");
  });
});
