import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";
import { useSettingsStore } from "@/store/settingsStore";
import { AUTH_RETURN_TO_KEY } from "@/lib/apiClient";

const login = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (state: { login: () => Promise<void> }) => unknown) =>
    selector({ login }),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    login.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = "#/login";
    useSettingsStore.setState({
      theme: "atelier-dark",
      themeMode: "dark",
      darkTheme: "atelier-dark",
      lightTheme: "atelier-light",
    });
  });

  it("uses the dedicated authentication brand lockup", () => {
    render(<LoginPage />);

    expect(screen.getByTestId("auth-surface")).toBeInTheDocument();
    const brandImage = screen.getByTestId("auth-brand").querySelector('img[alt="Omni Studio"]');
    expect(brandImage).toBeInTheDocument();
    expect(brandImage).toHaveAttribute("width", "30");
    expect(brandImage).toHaveAttribute("height", "30");
    expect(brandImage).toHaveStyle({ width: "30px", height: "30px" });
    expect(screen.getByTestId("auth-panel")).toBeInTheDocument();
  });

  it("toggles password visibility without submitting the form", () => {
    render(<LoginPage />);

    const passwordInput = screen.getByLabelText("password") as HTMLInputElement;
    expect(passwordInput.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "showPassword" }));
    expect(passwordInput.type).toBe("text");
    expect(screen.getByRole("button", { name: "hidePassword" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches the shared application theme from the authentication surface", () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "themeSwitch" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "themeLight" }));

    expect(useSettingsStore.getState()).toMatchObject({
      themeMode: "light",
      theme: "atelier-light",
    });
  });

  it("submits once while pending, remembers only the identifier and returns to the requested page", async () => {
    let finish!: () => void;
    login.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    sessionStorage.setItem(AUTH_RETURN_TO_KEY, "#/series");
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("identifier"), { target: { value: "artist@example.com" } });
    fireEvent.change(screen.getByLabelText("password"), { target: { value: "example-password" } });
    fireEvent.click(screen.getByLabelText("rememberMe"));
    fireEvent.click(screen.getByRole("button", { name: "login" }));
    expect(screen.getByRole("button", { name: "loggingIn" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "loggingIn" }));
    fireEvent.submit(screen.getByLabelText("password").closest("form")!);
    expect(login).toHaveBeenCalledExactlyOnceWith({ identifier: "artist@example.com", password: "example-password" });
    await act(async () => finish());
    expect(window.location.hash).toBe("#/series");
    expect(localStorage.getItem("omni_studio-remembered-identifier")).toBe("artist@example.com");
    expect(JSON.stringify(localStorage)).not.toContain("example-password");
  });

  it.each([
    [401, "AUTH_INVALID_CREDENTIALS", "errorInvalidCredentials"],
    [403, "AUTH_CSRF_FAILED", "errorCsrf"],
    [429, "AUTH_RATE_LIMITED", "errorRateLimited"],
    [500, "INTERNAL_ERROR", "errorLoginFailed"],
  ])("allows retry after an authentication error (%s)", async (status, code, message) => {
    login.mockRejectedValue({ isAxiosError: true, response: { status, data: { error: { code } } } });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("identifier"), { target: { value: "artist" } });
    fireEvent.change(screen.getByLabelText("password"), { target: { value: "example-password" } });
    fireEvent.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
    expect(screen.getByRole("button", { name: "login" })).toBeEnabled();
    expect(screen.getByLabelText("identifier")).toHaveValue("artist");
    expect(window.location.hash).toBe("#/login");
  });
});
