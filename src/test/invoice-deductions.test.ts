import { describe, expect, it } from "vitest";
import { deductionLines, invoiceNet } from "@/lib/invoiceDeductions";

describe("invoice percentage deductions", () => {
  it("2% QuickPay fee on $1,500 owes $1,470", () => {
    expect(invoiceNet(1500, [{ label: "QuickPay fee", pct: 2 }])).toBe(1470);
  });
  it("multiple deductions stack on the invoice amount", () => {
    expect(invoiceNet(1000, [{ label: "QuickPay fee", pct: 3 }, { label: "Lumper adjustment", pct: 1.5 }])).toBe(955);
  });
  it("deduction shows as a negative line", () => {
    expect(deductionLines(1500, [{ label: "QuickPay fee", pct: 2 }])[0]).toEqual({ label: "QuickPay fee (2%)", amount: -30 });
  });
  it("no deductions leaves the amount unchanged", () => {
    expect(invoiceNet(1500, [])).toBe(1500);
  });
});
