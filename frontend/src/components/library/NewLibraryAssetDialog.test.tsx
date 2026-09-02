import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
