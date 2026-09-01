/** @vitest-environment jsdom */

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/Providers";
import { useSettingsStore } from "@/store/settingsStore";

describe("system theme synchronization", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      locale: "zh",
      theme: "atelier-dark",
      themeMode: "dark",
      darkTheme: "atelier-dark",
      lightTheme: "atelier-light",
      animations: true,
    });
  });

  it("updates the application theme when the operating-system scheme changes", async () => {
    let prefersDark = false;
    let changeListener: ((event: MediaQueryListEvent) => void) | undefined;
    const mediaQuery = {
      get matches() { return prefersDark; },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        changeListener = listener;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));

    render(<Providers><div>content</div></Providers>);
    act(() => useSettingsStore.getState().setThemeMode("system", prefersDark));

    await waitFor(() => expect(document.documentElement).toHaveClass("atelier-light"));

    act(() => {
      prefersDark = true;
      changeListener?.({ matches: true } as MediaQueryListEvent);
    });

    await waitFor(() => expect(document.documentElement).toHaveClass("atelier-dark"));
  });
});
