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

describe("PromptInput focus styling", () => {
  beforeEach(() => {
    usePlaygroundStore.setState({ prompt: "", negativePrompt: "" });
  });

  it("removes the browser black outline from the prompt textarea", () => {
    render(<PromptInput />);

    const prompt = document.querySelector('textarea[placeholder="prompt.placeholder"]');
    expect(prompt).not.toBeNull();

    expect(prompt).toHaveClass("focus:outline-none", "focus:ring-0");
    expect(prompt).not.toHaveClass("outline-black");
  });

  it("keeps the negative prompt textarea on the same themed focus treatment", () => {
    render(<PromptInput />);

    fireEvent.click(screen.getByText("prompt.negativeLabel"));

    expect(document.querySelector('textarea[placeholder="prompt.negativePlaceholder"]')).toHaveClass(
      "focus:outline-none",
      "focus:ring-0",
    );
  });
});
