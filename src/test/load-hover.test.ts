import { describe, expect, it } from "vitest";
import { hoverLoadNumber, loadHoverAllowed } from "@/lib/loadHover";

describe("app-wide load hover", () => {
  it("allows Accounting and other app screens", () => {
    expect(loadHoverAllowed(false, false)).toBe(true);
  });
  it("excludes the Dispatch board and load details", () => {
    expect(loadHoverAllowed(true, false)).toBe(false);
  });
  it("does not preview load numbers being entered into forms", () => {
    expect(loadHoverAllowed(false, true)).toBe(false);
  });
  it("resolves one load reference without guessing between several loads", () => {
    expect(hoverLoadNumber("CW-10583 · INV-123")).toBe("CW-10583");
    expect(hoverLoadNumber("CW-10583 CW-10584")).toBeNull();
  });
});