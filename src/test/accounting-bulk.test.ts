import { describe, expect, it } from "vitest";
import { checkedAccountingRows, uniqueAccountingInvoices } from "@/lib/accountingBulk";

describe("apply to all checked accounting rows", () => {
  it("applies to every checked row, not unchecked or filtered-out rows", () => {
    expect(checkedAccountingRows([{ id: "a" }, { id: "b" }, { id: "c" }], ["a", "c", "hidden"]).map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("reviews a combined invoice once while keeping different companies separate", () => {
    const row = (id: string, kind: string, invoice_number: string | null) => ({ id, kind, invoice_number });
    expect(uniqueAccountingInvoices([row("a", "invoice", "INV-1"), row("b", "invoice", "INV-1"), row("c", "fleet_invoice", "INV-1"), row("d", "bill", null), row("e", "bill", null)]).map((r) => r.id)).toEqual(["a", "c", "d", "e"]);
  });
});