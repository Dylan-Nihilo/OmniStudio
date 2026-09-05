import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateLibraryAsset = vi.fn();
const errorToast = vi.fn();
const listSeries = vi.fn();
const getProjects = vi.fn();
const listLibraryAssets = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/store/toastStore", () => ({ toast: { error: (...args: unknown[]) => errorToast(...args) } }));
vi.mock("@/components/layout/AppShell", () => ({ default: ({ children, context }: any) => <>{context}{children}</> }));
vi.mock("@/lib/api", () => ({
  API_URL: "http://localhost:17177",
  api: {
    updateLibraryAsset: (...args: unknown[]) => updateLibraryAsset(...args),
    listSeries: (...args: unknown[]) => listSeries(...args),
    getProjects: (...args: unknown[]) => getProjects(...args),
    listLibraryAssets: (...args: unknown[]) => listLibraryAssets(...args),
  },
}));

import AssetLibraryPage from "./AssetLibraryPage";
import AssetInspector from "./AssetInspector";

describe("AssetLibraryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSeries.mockResolvedValue([]);
    getProjects.mockResolvedValue([]);
    listLibraryAssets.mockResolvedValue({
      characters: [],
      scenes: [
        {
          id: "scene-stage2",
          name: "Stage 2 protected image",
          description: "Uploaded media access regression fixture",
          image_url: "uploads/stage2.jpg",
          image_asset: { variants: [] },
          video_assets: [],
          locked: false,
          starred: false,
          status: "pending",
        },
      ],
      props: [],
    });
  });

  it("routes relative library images through the authenticated media proxy", async () => {
    render(<AssetLibraryPage />);

    expect(await screen.findByRole("img", { name: "Stage 2 protected image" })).toHaveAttribute(
      "src",
      "/api-proxy/files/uploads/stage2.jpg",
    );
  });

  it("reports a failed star update and restores the previous value", async () => {
    updateLibraryAsset.mockRejectedValueOnce(new Error("Star unavailable"));
    render(<AssetLibraryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "star" }));
    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "star" })).toHaveAttribute("aria-pressed", "false");
  });

  it("routes the inspector hero image through the authenticated media proxy", () => {
    render(
      <AssetInspector
        asset={{
          id: "scene-stage2",
          name: "Stage 2 protected image",
          description: "Uploaded media access regression fixture",
          image_url: "uploads/stage2.jpg",
          image_asset: { selected_id: null, variants: [] },
          video_assets: [],
          locked: false,
          starred: false,
          status: "pending",
        }}
        type="scenes"
        sourceName="globalGroup"
        sourceId="global"
        sourceKind="global"
        starred={false}
        onClose={vi.fn()}
        onToggleStar={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "Stage 2 protected image" })).toHaveAttribute(
      "src",
      "/api-proxy/files/uploads/stage2.jpg",
    );
  });
});
