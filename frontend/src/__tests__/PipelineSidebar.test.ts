import { describe, expect, it } from "vitest";
import {
  getActiveStepIndicatorClasses,
  getStepMetaClasses,
} from "@/components/layout/PipelineSidebar";

describe("PipelineSidebar layout", () => {
  it("centers the active marker without a transform that motion can override", () => {
    const classes = getActiveStepIndicatorClasses();

    expect(classes).toContain("inset-y-[20%]");
    expect(classes).not.toContain("translate-y");
  });

  it("lets long step status text wrap instead of truncating it", () => {
    const classes = getStepMetaClasses();

    expect(classes).toContain("w-full");
    expect(classes).toContain("min-w-0");
    expect(classes).not.toContain("truncate");
    expect(classes).not.toContain("whitespace-nowrap");
  });
});
