import { describe, expect, it } from "vitest";
import { calculateCenteredScrollTop } from "./scroll-position";

describe("calculateCenteredScrollTop", () => {
  it("centers a focus region when enough content surrounds it", () => {
    expect(calculateCenteredScrollTop({
      anchorHeight: 80,
      anchorTop: 720,
      contentHeight: 2_000,
      viewportHeight: 400,
    })).toBe(560);
  });

  it("keeps the document at the top when the focus has too little leading content", () => {
    expect(calculateCenteredScrollTop({
      anchorHeight: 40,
      anchorTop: 80,
      contentHeight: 2_000,
      viewportHeight: 400,
    })).toBe(0);
  });

  it("clamps to the final scroll position when the focus is near the bottom", () => {
    expect(calculateCenteredScrollTop({
      anchorHeight: 80,
      anchorTop: 1_850,
      contentHeight: 2_000,
      viewportHeight: 400,
    })).toBe(1_600);
  });
});
