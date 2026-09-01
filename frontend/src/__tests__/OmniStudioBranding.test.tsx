/** @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settingsStore";
import OmniStudioBranding from "@/components/layout/OmniStudioBranding";

describe("OmniStudioBranding", () => {
  afterEach(() => {
    useSettingsStore.getState().setTheme("atelier-dark");
  });

  it("renders the Omni Studio identity and the supplied infinity logo", () => {
    render(<OmniStudioBranding />);

    expect(screen.getByText("Stories, Rendered Alive.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Omni Studio" })).toHaveAttribute("src", "/omni-studio-logo.png");
  });

  it("uses a dedicated GPT Image logo on light themes", async () => {
    act(() => {
      useSettingsStore.getState().setTheme("atelier-light");
    });
    render(<OmniStudioBranding />);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Omni Studio" })).toHaveAttribute("src", "/omni-studio-logo.png");
    });
  });

  it("uses the GPT Image dark mark for the authentication lockup", () => {
    render(<OmniStudioBranding variant="auth" />);

    expect(screen.getByRole("img", { name: "Omni Studio" })).toHaveAttribute("src", "/omni-studio-logo.png");
  });
});
