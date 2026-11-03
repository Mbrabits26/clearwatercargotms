import { describe, expect, it } from "vitest";
import { findQbDuplicate } from "@/lib/qbDupGuard";
import type { QbInvoice } from "@/lib/qbMatch";

const inv = (extra: Partial<QbInvoice> = {}): QbInvoice => ({ id: "77", docNumber: "2673", date: "2026-10-01", customer: "Peak City Lumber, LLC", total: 775, balance: 775, lines: [], text: "", ...extra });

describe("QuickBooks duplicate guard before sending an invoice", () => {
  it("links to an existing invoice that names the load #", () => {
    expect(findQbDuplicate([inv({ text: "Freight CW-15418 Staley to Raleigh", total: 800 })], "Peak City Lumber", [{ load_number: "CW-15418" }], 775, "2026-10-02")?.kind).toBe("same");
  });
  it("links to an existing invoice that has the customer ref #", () => {
    expect(findQbDuplicate([inv({ text: "PO W0-55812" })], "Peak City Lumber", [{ load_number: "CW-1", customer_ref: "W055812" }], 1, "2026-10-02")?.kind).toBe("same");
  });
  it("holds when only customer + amount + date line up", () => {
    expect(findQbDuplicate([inv()], "Peak City Lumber", [{ load_number: "CW-1" }], 775, "2026-10-05")?.kind).toBe("maybe");
  });
  it("ignores another customer's invoice with the same amount and load-like text", () => {
    expect(findQbDuplicate([inv({ customer: "Madison Wood Preservers", text: "CW-1" })], "Peak City Lumber", [{ load_number: "CW-1" }], 775, "2026-10-02")).toBeNull();
  });
  it("same amount more than 10 days apart is not a duplicate", () => {
    expect(findQbDuplicate([inv({ date: "2026-08-01" })], "Peak City Lumber", [{ load_number: "CW-1" }], 775, "2026-10-02")).toBeNull();
  });
});
