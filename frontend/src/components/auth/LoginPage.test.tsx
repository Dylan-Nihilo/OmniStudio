import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";
import { useSettingsStore } from "@/store/settingsStore";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (state: { login: () => Promise<void> }) => unknown) =>
    selector({ login: () => Promise.resolve() }),
}));

describe("LoginPage", () => {
  beforeEach(() => {
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
    expect(screen.getByTestId("auth-brand").querySelector('img[alt="Omni Studio"]')).toBeInTheDocument();
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
});
