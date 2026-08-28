import { describe, expect, it } from "vitest";
import { isSafeReturnHash } from "@/lib/apiClient";

describe("authentication hash routing", () => {
  it("does not remember public authentication pages as return targets", () => {
    expect(isSafeReturnHash("#/login")).toBe(false);
    expect(isSafeReturnHash("#/setup")).toBe(false);
    expect(isSafeReturnHash("#/reset-password")).toBe(false);
  });

  it("keeps protected workspace hashes as safe return targets", () => {
    expect(isSafeReturnHash("#/workspace")).toBe(true);
    expect(isSafeReturnHash("#/settings")).toBe(true);
  });
});
