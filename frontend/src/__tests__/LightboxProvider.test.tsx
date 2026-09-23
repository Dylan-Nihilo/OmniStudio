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
        const root = screen.getByTestId("lightbox-root");
        const backdrop = document.querySelector('[aria-hidden="true"]');
        const toolbar = screen.getByTitle("copyUrl").parentElement;

        expect(root).toHaveAttribute("data-react-aria-top-layer", "true");
        expect(root).toHaveClass("z-[1000]", "pointer-events-auto");
        expect(backdrop).toHaveClass("z-0", "pointer-events-auto");
        expect(dialog).toHaveClass("z-10", "pointer-events-auto");
        expect(toolbar).toHaveClass("z-20", "pointer-events-auto");
        expect(screen.getByTitle("copyUrl")).toHaveClass("bg-[#101018]/95", "border-white/35", "text-white");
        expect(screen.getByRole("button", { name: "close" })).toHaveClass("bg-[#101018]/95", "border-white/35", "text-white");
    });

    it("keeps backdrop and toolbar actions inside the lightbox layer", () => {
        render(
            <>
                <div data-testid="generation-modal-backdrop" className="fixed inset-0 z-[100]" />
                <LightboxProvider>
                    <Trigger />
                </LightboxProvider>
            </>,
        );

        fireEvent.click(screen.getByRole("button", { name: "open" }));
        fireEvent.click(screen.getByTitle("copyUrl"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "close" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "open" }));
        fireEvent.click(document.querySelector('[aria-hidden="true"]')!);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
});
