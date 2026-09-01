/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthGate from "@/components/auth/AuthGate";

const bootstrap = vi.fn(() => Promise.resolve());
let storeState: Record<string, unknown>;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/layout/OmniStudioBranding", () => ({
  default: () => <div>Omni Studio</div>,
}));

vi.mock("@/components/auth/LoginPage", () => ({
  default: () => <div data-testid="login-page" />,
}));

vi.mock("@/components/auth/SetupPage", () => ({
  default: () => <div data-testid="setup-page" />,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) => selector(storeState),
}));

describe("AuthGate legacy claim routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/workspace";
    storeState = {
      bootstrap,
      bootstrapping: false,
      setupStatus: {
        initialized: true,
        setup_allowed: false,
        setup_token_required: false,
      },
      user: { id: "owner-1" },
      legacyClaimPending: true,
    };
  });

  it("keeps an authenticated owner on setup until legacy claim is acknowledged", async () => {
    render(
      <AuthGate>
        <div data-testid="workspace-page" />
      </AuthGate>,
    );

    expect(screen.getByTestId("setup-page")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-page")).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/setup"));
  });
});
