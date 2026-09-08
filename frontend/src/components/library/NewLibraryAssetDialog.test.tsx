import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import NewLibraryAssetDialog from "./NewLibraryAssetDialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
  api: {
    createLibraryAsset: vi.fn(),
    uploadLibraryImage: vi.fn(),
  },
}));

vi.mock("@/lib/utils", () => ({
  getAssetUrl: (value: string) => value,
}));

vi.mock("@/store/toastStore", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("NewLibraryAssetDialog", () => {
  it("keeps create disabled until the asset name contains non-whitespace text", () => {
    render(<NewLibraryAssetDialog onClose={vi.fn()} onCreated={vi.fn()} />);

    const createButton = screen.getByRole("button", { name: "create" });
    const nameInput = screen.getByLabelText("nameLabel");

    expect(createButton).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: "   " } });
    expect(createButton).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: "Hero" } });
    expect(createButton).toBeEnabled();
  });
  it("retains the draft and prevents dismissal during an upload", async () => {
    let rejectUpload!: (error: Error) => void;
    vi.mocked(api.uploadLibraryImage).mockReturnValue(new Promise((_, reject) => { rejectUpload = reject; }));
    const onClose = vi.fn();
    render(<NewLibraryAssetDialog onClose={onClose} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("nameLabel"), { target: { value: "Mara" } });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["image"], "mara.png", { type: "image/png" })] } });
    expect(screen.getByRole("button", { name: "close" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    rejectUpload(new Error("Upload unavailable"));
    await waitFor(() => expect(screen.getByRole("button", { name: "close" })).toBeEnabled());
    expect(screen.getByLabelText("nameLabel")).toHaveValue("Mara");
    expect(screen.getByRole("alert")).toHaveTextContent("Upload unavailable");
  });

});
