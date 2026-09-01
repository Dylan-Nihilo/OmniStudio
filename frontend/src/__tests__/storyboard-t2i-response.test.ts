import { describe, expect, it } from "vitest";

import { extractT2IImageUrl } from "@/components/modules/storyboard-r2v/shotNodeHelpers";

describe("extractT2IImageUrl", () => {
    it("reads the rendered image from a full storyboard render response", () => {
        const result = extractT2IImageUrl({
            id: "project-1",
            frames: [
                { id: "other", image_url: "other.png" },
                { id: "frame-1", rendered_image_url: "storyboard/frame-1.png" },
            ],
        }, "frame-1");

        expect(result).toBe("storyboard/frame-1.png");
    });
});
