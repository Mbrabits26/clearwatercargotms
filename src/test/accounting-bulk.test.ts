import { describe, expect, it } from "vitest";
import { accountingBulkPatch, checkedAccountingRows, uniqueAccountingInvoices } from "@/lib/accountingBulk";

describe("apply to all checked accounting rows", () => {
  it("applies to every checked row, not unchecked or filtered-out rows", () => {
    expect(checkedAccountingRows([{ id: "a" }, { id: "b" }, { id: "c" }], ["a", "c", "hidden"]).map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("reviews a combined invoice once while keeping different companies separate", () => {
    const row = (id: string, kind: string, invoice_number: string | null) => ({ id, kind, invoice_number });
    expect(uniqueAccountingInvoices([row("a", "invoice", "INV-1"), row("b", "invoice", "INV-1"), row("c", "fleet_invoice", "INV-1"), row("d", "bill", null), row("e", "bill", null)]).map((r) => r.id)).toEqual(["a", "c", "d", "e"]);
  });
  it("uses the chosen amount for all checked entries without changing carrier settings", () => {
    expect(accountingBulkPatch("amount", "1200.50")).toEqual({ amount: 1200.5 });
    expect(() => accountingBulkPatch("amount", "-1")).toThrow();
  });
  it("uses the chosen customer deduction percentage, including removing it at zero", () => {
    expect(accountingBulkPatch("deductions", "2.5")).toEqual({ deductions: [{ label: "QuickPay fee", pct: 2.5 }] });
    expect(accountingBulkPatch("deductions", "0")).toEqual({ deductions: [] });
    expect(() => accountingBulkPatch("deductions", "101")).toThrow();
  });
  it("rejects invalid dates before changing any checked invoice", () => {
    expect(accountingBulkPatch("due_date", "2026-11-30")).toEqual({ due_date: "2026-11-30" });
    expect(() => accountingBulkPatch("due_date", "2026-02-30")).toThrow();
  });
});