/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupPage from "@/components/auth/SetupPage";
import { useSettingsStore } from "@/store/settingsStore";

const { getStatus, preview, apply, rollback } = vi.hoisted(() => ({
  getStatus: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  rollback: vi.fn(),
}));
const setup = vi.fn<() => Promise<void>>();
const finishLegacyClaim = vi.fn();

let storeState: Record<string, unknown>;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/layout/OmniStudioBranding", () => ({
  default: (props: { size?: string; variant?: string }) => <div data-testid="brand" data-size={props.size} data-variant={props.variant}>Omni Studio</div>,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) => selector(storeState),
}));

vi.mock("@/lib/api", () => ({
  legacyClaimApi: { getStatus, preview, apply, rollback },
}));

const readyStatus = {
  state: "ready",
  source_sha256: "a".repeat(64),
  source_files: [],
  summary: { projects: 3, series: 1, media: 7, conflicts: 0 },
  diagnostics: [],
  rollback_available: false,
  batch: null,
};

describe("SetupPage legacy claim flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/setup";
    storeState = {
      setup,
      setupStatus: {
        initialized: false,
        setup_allowed: true,
        setup_token_required: false,
      },
      legacyClaimPending: false,
      finishLegacyClaim,
    };
    setup.mockResolvedValue(undefined);
    getStatus.mockResolvedValue(readyStatus);
    preview.mockResolvedValue(readyStatus);
    apply.mockResolvedValue({
      ...readyStatus,
      state: "claimed",
      rollback_available: true,
      batch: {
        id: "batch-1",
        source_sha256: readyStatus.source_sha256,
        status: "claimed",
        project_ids: ["p1", "p2", "p3"],
        series_ids: ["s1"],
        created_at: 1,
        completed_at: 1,
        rolled_back_at: null,
      },
    });
    rollback.mockResolvedValue({
      ...readyStatus,
      state: "rolled_back",
      rollback_available: false,
    });
    useSettingsStore.setState({
      theme: "atelier-dark",
      themeMode: "dark",
      darkTheme: "atelier-dark",
      lightTheme: "atelier-light",
    });
  });

  it("offers the shared theme switch before the owner account exists", () => {
    render(<SetupPage />);

    fireEvent.click(screen.getByRole("button", { name: "themeSwitch" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "themeLight" }));

    expect(useSettingsStore.getState()).toMatchObject({
      themeMode: "light",
      theme: "atelier-light",
    });
  });

  it("stays on setup after creating the owner so claim summary can be shown", async () => {
    render(<SetupPage />);

    expect(screen.getByTestId("auth-brand").querySelector('img[alt="Omni Studio"]')).toBeInTheDocument();
    expect(screen.getByTestId("auth-panel")).toHaveAccessibleName("setupTitle");

    fireEvent.change(screen.getByLabelText("username"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("email"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("password"), { target: { value: "correct horse" } });
    fireEvent.change(screen.getByLabelText("confirmPassword"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "setupAction" }));

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1));
    expect(window.location.hash).toBe("#/setup");
  });

  it.each([false, true])("keeps the setup token accessible and requires it only when requested (%s)", (required) => {
    storeState.setupStatus = { initialized: false, setup_allowed: true, setup_token_required: required };
    render(<SetupPage />);
    const token = screen.getByLabelText("setupToken");

    expect(token.hasAttribute("required")).toBe(required);
    if (required) {
      expect(token).toBeVisible();
      expect(token.closest("details")).toBeNull();
    } else {
      expect(token).not.toBeVisible();
      fireEvent.click(token.closest("details")!.querySelector("summary")!);
      expect(token).toBeVisible();
    }
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveAccessibleDescription("setupTokenHint");
    expect(setup).not.toHaveBeenCalled();
  });

  it("preserves password confirmation and allows revealing a password without submitting", async () => {
    render(<SetupPage />);
    fireEvent.change(screen.getByLabelText("username"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("email"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("password"), { target: { value: "correct horse" } });
    fireEvent.change(screen.getByLabelText("confirmPassword"), { target: { value: "different password" } });
    fireEvent.click(screen.getAllByRole("button", { name: "showPassword" })[0]);
    expect(screen.getByLabelText("password")).toHaveAttribute("type", "text");
    expect(setup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "setupAction" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("errorPasswordsDoNotMatch");
    expect(setup).not.toHaveBeenCalled();
  });

  it("submits the required token once while pending and preserves inputs after an API error", async () => {
    storeState.setupStatus = { initialized: false, setup_allowed: true, setup_token_required: true };
    let reject!: (error: unknown) => void;
    setup.mockImplementation(() => new Promise((_, rejectRequest) => { reject = rejectRequest; }));
    render(<SetupPage />);
    fireEvent.change(screen.getByLabelText("username"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("email"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("password"), { target: { value: "correct horse" } });
    fireEvent.change(screen.getByLabelText("confirmPassword"), { target: { value: "correct horse" } });
    fireEvent.change(screen.getByLabelText("setupToken"), { target: { value: "test-setup-token" } });
    fireEvent.click(screen.getByRole("button", { name: "setupAction" }));
    expect(screen.getByRole("button", { name: "settingUp" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.submit(screen.getByLabelText("password").closest("form")!);
    expect(setup).toHaveBeenCalledExactlyOnceWith({ username: "owner", email: "owner@example.com", password: "correct horse", setup_token: "test-setup-token" });

    await act(async () => reject({ response: { data: { error: { message: "Invalid setup token" } } } }));
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid setup token");
    expect(screen.getByLabelText("username")).toHaveValue("owner");
    expect(screen.getByLabelText("setupToken")).toHaveValue("test-setup-token");
    expect(screen.getByRole("button", { name: "setupAction" })).toBeEnabled();
  });

  it("shows the setup restriction without an account form", () => {
    storeState.setupStatus = { initialized: false, setup_allowed: false, setup_token_required: true };
    render(<SetupPage />);
    expect(screen.getByRole("status")).toHaveTextContent("setupNotAllowed");
    expect(screen.queryByRole("button", { name: "setupAction" })).not.toBeInTheDocument();
  });

  it("renders the project series media and conflict summary", async () => {
    storeState = {
      ...storeState,
      setupStatus: { initialized: true, setup_allowed: false, setup_token_required: false },
      legacyClaimPending: true,
    };

    render(<SetupPage />);

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("legacyClaimProjects")).toBeInTheDocument();
    expect(screen.getByText("legacyClaimSeries")).toBeInTheDocument();
    expect(screen.getByText("legacyClaimMedia")).toBeInTheDocument();
    expect(screen.getByText("legacyClaimConflicts")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("auth-surface");
    expect(screen.getByRole("main").querySelector("section")).toHaveClass("auth-panel");
  });

  it("offers direct workspace entry when there is no old data to claim", async () => {
    getStatus.mockResolvedValue({
      ...readyStatus,
      source_sha256: null,
      summary: { projects: 0, series: 0, media: 0, conflicts: 0 },
    });
    storeState = {
      ...storeState,
      setupStatus: { initialized: true, setup_allowed: false, setup_token_required: false },
      legacyClaimPending: true,
    };
    render(<SetupPage />);

    fireEvent.click(await screen.findByRole("button", { name: "legacyClaimEnterWorkspace" }));
    expect(finishLegacyClaim).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/workspace");
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies the confirmed source hash before allowing workspace entry", async () => {
    storeState = {
      ...storeState,
      setupStatus: { initialized: true, setup_allowed: false, setup_token_required: false },
      legacyClaimPending: true,
    };
    render(<SetupPage />);

    fireEvent.click(await screen.findByRole("button", { name: "legacyClaimApply" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(readyStatus.source_sha256));
    expect(await screen.findByText("legacyClaimClaimed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "legacyClaimEnterWorkspace" }));
    expect(finishLegacyClaim).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/workspace");
  });

  it("shows blocked diagnostics without offering apply", async () => {
    getStatus.mockResolvedValue({
      ...readyStatus,
      state: "blocked",
      summary: { ...readyStatus.summary, conflicts: 2 },
      diagnostics: [{ type: "invalid_source", message: "Invalid legacy JSON" }],
    });
    storeState = {
      ...storeState,
      setupStatus: { initialized: true, setup_allowed: false, setup_token_required: false },
      legacyClaimPending: true,
    };

    render(<SetupPage />);

    expect(await screen.findByText("legacyClaimBlocked")).toBeInTheDocument();
    expect(screen.getByText("Invalid legacy JSON")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "legacyClaimApply" })).not.toBeInTheDocument();
  });

  it("rolls back a completed claim from the same summary", async () => {
    getStatus.mockResolvedValue(await apply());
    storeState = {
      ...storeState,
      setupStatus: { initialized: true, setup_allowed: false, setup_token_required: false },
      legacyClaimPending: true,
    };
    render(<SetupPage />);

    fireEvent.click(await screen.findByRole("button", { name: "legacyClaimRollback" }));

    await waitFor(() => expect(rollback).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("legacyClaimRolledBack")).toBeInTheDocument();
  });
});
