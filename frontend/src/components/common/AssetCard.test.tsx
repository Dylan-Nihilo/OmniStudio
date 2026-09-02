import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
  API_URL: "/api-proxy",
}));

vi.mock("@/lib/characterImage", () => ({
  characterImageUrl: (asset: { image_url?: string }) => asset.image_url,
}));

import AssetCard from "./AssetCard";

describe("AssetCard", () => {
  it("routes Windows-style relative image paths through the protected media proxy", () => {
    render(
      <AssetCard
        type="characters"
        asset={{
          id: "char-1",
          name: "林夏",
          description: "记者",
          image_url: "assets\\characters\\linxia.png",
        } as never}
      />,
    );

    expect(screen.getByRole("img", { name: "林夏" })).toHaveAttribute(
      "src",
      "/api-proxy/files/assets/characters/linxia.png",
    );
  });
});
