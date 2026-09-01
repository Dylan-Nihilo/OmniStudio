/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightboxProvider, useLightbox } from "@/components/shared/preview/LightboxProvider";

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

function Trigger() {
    const { open } = useLightbox();
    return (
        <button
            type="button"
            onClick={() => open({ src: "uploads/example.jpg", alt: "Example", kind: "image" })}
        >
            open
        </button>
    );
}

describe("LightboxProvider", () => {
    it("renders above workspace modals with a readable toolbar", () => {
        render(
            <LightboxProvider>
                <Trigger />
            </LightboxProvider>,
        );

        fireEvent.click(screen.getByRole("button", { name: "open" }));

        const dialog = screen.getByRole("dialog");
        const backdrop = document.querySelector('[aria-hidden="true"]');
        const toolbar = screen.getByTitle("copyUrl").parentElement;

        expect(backdrop).toHaveClass("z-[300]");
        expect(dialog).toHaveClass("z-[301]");
        expect(toolbar).toHaveClass("z-[302]");
        expect(screen.getByTitle("copyUrl")).toHaveClass("bg-[#101018]/95", "border-white/35", "text-white");
        expect(screen.getByRole("button", { name: "close" })).toHaveClass("bg-[#101018]/95", "border-white/35", "text-white");
    });
});
