import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSeries = vi.fn();
const getProjects = vi.fn();
const listLibraryAssets = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
  API_URL: "http://localhost:17177",
  api: {
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
