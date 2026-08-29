import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settingsStore";
import LumenXBranding from "./LumenXBranding";

describe("LumenXBranding", () => {
  afterEach(() => {
    useSettingsStore.getState().setTheme("atelier-dark");
  });

  it("renders the MANGIX STUDIO identity and its original icon", () => {
    render(<LumenXBranding />);

    expect(screen.getByText("MANGIX")).toBeInTheDocument();
    expect(screen.getByText("STUDIO")).toBeInTheDocument();
    expect(screen.getByText("Stories, Rendered Alive.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "MANGIX Studio" })).toHaveAttribute("src", "/mangix-mark-gpt.png");
  });

  it("uses a dedicated GPT Image logo on light themes", async () => {
    act(() => {
      useSettingsStore.getState().setTheme("atelier-light");
    });
    render(<LumenXBranding />);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "MANGIX Studio" })).toHaveAttribute("src", "/mangix-mark-gpt-light.png");
    });
  });

  it("uses the GPT Image dark mark for the authentication lockup", () => {
    render(<LumenXBranding variant="auth" />);

    expect(screen.getByRole("img", { name: "MANGIX Studio" })).toHaveAttribute("src", "/mangix-mark-gpt.png");
  });
});
