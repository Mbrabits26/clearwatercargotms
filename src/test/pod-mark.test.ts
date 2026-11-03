import { describe, expect, it } from "vitest";
import { marksPod, POD_QUERY_ROOTS } from "@/lib/podMark";

describe("uploading a Signed POD marks the load POD received", () => {
  it("a file tagged Signed POD marks the POD", () => expect(marksPod("pod")).toBe(true));
  it("a signed rate con never counts as a POD", () => expect(marksPod("ratecon")).toBe(false));
  it("BOL, lumper, scale and other files never count as a POD", () => {
    for (const t of ["bol", "lumper", "scale", "other"]) expect(marksPod(t)).toBe(false);
  });
  it("refreshes load lists, work notices and invoiced-load lists", () => {
    expect(POD_QUERY_ROOTS).toEqual(expect.arrayContaining(["loads", "load-work", "qb_sync"]));
  });
});
