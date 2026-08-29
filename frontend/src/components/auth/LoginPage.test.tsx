import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (state: { login: () => Promise<void> }) => unknown) =>
    selector({ login: () => Promise.resolve() }),
}));

describe("LoginPage", () => {
  it("uses the dedicated authentication brand lockup", () => {
    render(<LoginPage />);

    expect(screen.getByTestId("auth-surface")).toBeInTheDocument();
    expect(screen.getByTestId("auth-brand")).toHaveTextContent("MANGIX");
    expect(screen.getByTestId("auth-brand")).toHaveTextContent("STUDIO");
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
});
