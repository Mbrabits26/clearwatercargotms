import { describe, expect, it } from "vitest";
import { cleanDocName } from "@/lib/docNames";

describe("cleanDocName", () => {
  it("adds the original file type back when it's left off", () => {
    expect(cleanDocName("POD Load 1042", "abc/file-123-scan.pdf")).toBe("POD Load 1042.pdf");
  });
  it("keeps a name that already has the right file type", () => {
    expect(cleanDocName("Lumper receipt.PDF", "x/y.pdf")).toBe("Lumper receipt.PDF");
  });
  it("rejects a blank name", () => {
    expect(cleanDocName("   ", "x/y.pdf")).toBeNull();
  });
});
