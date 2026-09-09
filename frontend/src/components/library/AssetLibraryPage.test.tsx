import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateLibraryAsset = vi.fn();
const deleteLibraryAsset = vi.fn();
const uploadLibraryImage = vi.fn();
const updateSeriesAssetImage = vi.fn();
const updateAssetImage = vi.fn();
const errorToast = vi.fn();
const listSeries = vi.fn();
const getProjects = vi.fn();
const listLibraryAssets = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/store/toastStore", () => ({ toast: { success: vi.fn(), error: (...args: unknown[]) => errorToast(...args) } }));
vi.mock("@/components/layout/AppShell", () => ({ default: ({ children, context }: any) => <>{context}{children}</> }));
vi.mock("@/lib/api", () => ({
  API_URL: "http://localhost:17177",
  api: {
    uploadLibraryImage: (...args: unknown[]) => uploadLibraryImage(...args),
    updateSeriesAssetImage: (...args: unknown[]) => updateSeriesAssetImage(...args),
    updateAssetImage: (...args: unknown[]) => updateAssetImage(...args),
    updateLibraryAsset: (...args: unknown[]) => updateLibraryAsset(...args),
    deleteLibraryAsset: (...args: unknown[]) => deleteLibraryAsset(...args),
    listSeries: (...args: unknown[]) => listSeries(...args),
    getProjects: (...args: unknown[]) => getProjects(...args),
    listLibraryAssets: (...args: unknown[]) => listLibraryAssets(...args),
  },
}));

import AssetLibraryPage from "./AssetLibraryPage";
import AssetInspector from "./AssetInspector";

describe("AssetLibraryPage", () => {
  it("edits shared metadata, cancels deletion, and keeps referenced assets after a rejected delete", async () => {
    render(<AssetLibraryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Stage 2 protected image" }));
    fireEvent.click(screen.getByRole("button", { name: "editAsset" }));
    fireEvent.change(screen.getByRole("textbox", { name: /nameLabel/ }), { target: { value: "Night station" } });
    fireEvent.change(screen.getByRole("textbox", { name: "descLabel" }), { target: { value: "Warm lights" } });
    updateLibraryAsset.mockResolvedValueOnce({ id: "scene-stage2", name: "Night station", description: "Warm lights", image_url: "uploads/stage2.jpg" });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(updateLibraryAsset).toHaveBeenCalledWith("scene", "scene-stage2", { name: "Night station", description: "Warm lights" }));
    expect(await screen.findByRole("heading", { name: "Night station" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "deleteAsset" }));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(deleteLibraryAsset).not.toHaveBeenCalled();
    deleteLibraryAsset.mockRejectedValueOnce({ response: { data: { detail: { message: "Still used by shot 1" } } } });
    fireEvent.click(screen.getByRole("button", { name: "deleteAsset" }));
    fireEvent.click(screen.getByRole("button", { name: "confirmDelete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Still used by shot 1");
    expect(screen.getByRole("heading", { name: "Night station" })).toBeVisible();
    deleteLibraryAsset.mockResolvedValueOnce({ status: "deleted" });
    listLibraryAssets.mockResolvedValueOnce({ characters: [], scenes: [], props: [] });
    fireEvent.click(screen.getByRole("button", { name: "confirmDelete" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Night station" })).not.toBeInTheDocument());
  });
  it("keeps asset types in navigation and source filtering in the gallery toolbar", async () => {
    render(<AssetLibraryPage />);
    await screen.findByRole("img", { name: "Stage 2 protected image" });
    const navigation = screen.getByRole("navigation", { name: "title" });
    expect(within(navigation).queryByRole("heading")).not.toBeInTheDocument();
    expect(within(navigation).getAllByRole("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /metaSource/ }).closest("nav")).toBeNull();
  });

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
  it.each(["global", "series", "project"] as const)("replaces the master through the %s source API", async (sourceKind) => {
    const asset = { id: "scene", name: "Old image", description: "", image_url: "old.png", image_asset: { selected_id: null, variants: [] } } as any;
    const updated = { ...asset, image_url: "new.png" };
    const onAssetUpdated = vi.fn();
    uploadLibraryImage.mockResolvedValue({ image_url: "new.png" });
    updateLibraryAsset.mockResolvedValue(updated);
    updateSeriesAssetImage.mockResolvedValue({ scenes: [updated] });
    updateAssetImage.mockResolvedValue({ scenes: [updated] });
    render(<AssetInspector asset={asset} type="scenes" sourceName="source" sourceId={`${sourceKind}-owner`} sourceKind={sourceKind} starred={false} onClose={vi.fn()} onToggleStar={vi.fn()} onAssetUpdated={onAssetUpdated} />);
    fireEvent.change(screen.getByLabelText("replaceImage"), { target: { files: [new File(["new"], "new.png", { type: "image/png" })] } });
    await waitFor(() => expect(onAssetUpdated).toHaveBeenCalledWith(updated));
    const update = sourceKind === "global" ? updateLibraryAsset : sourceKind === "series" ? updateSeriesAssetImage : updateAssetImage;
    expect(update).toHaveBeenCalledWith(...(sourceKind === "global" ? ["scene", "scene", { image_url: "new.png" }] : ["owner", "scene", "scene", "new.png"]));
  });

  it("retains the displayed master and allows retry when replacement fails", async () => {
    uploadLibraryImage.mockRejectedValueOnce(new Error("Upload unavailable"));
    const onAssetUpdated = vi.fn();
    render(<AssetInspector asset={{ id: "scene", name: "Old image", description: "", image_url: "old.png" } as any} type="scenes" sourceName="global" sourceId="global" sourceKind="global" starred={false} onClose={vi.fn()} onToggleStar={vi.fn()} onAssetUpdated={onAssetUpdated} />);
    fireEvent.change(screen.getByLabelText("replaceImage"), { target: { files: [new File(["new"], "new.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload unavailable");
    expect(screen.getByRole("img", { name: "Old image" })).toHaveAttribute("src", "/api-proxy/files/old.png");
    expect(onAssetUpdated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "replaceImage" })).toBeEnabled();
  });

});
