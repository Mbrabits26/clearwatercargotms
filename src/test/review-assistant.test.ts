import { describe, it, expect } from "vitest";
import { closeoutRows, matchRows, type ReviewPlan } from "@/lib/reviewAssistant";

const plan = (p: Partial<ReviewPlan>): ReviewPlan => ({ mode: "closeout", customer: null, from: null, to: null, minDaysSinceDelivery: null, entity: "brokerage", summary: "", ...p });
const load = (o: object) => ({ id: "1", load_number: "CW-1", customer: "Peak City Lumber", status: "paid", closed_at: null, delivery_at: "2026-08-01", pickup_at: null, customer_rate: 775, ...o });

describe("review assistant", () => {
  it("closeout lists only paid, open loads", () => {
    const now = new Date("2026-10-23").getTime();
    expect(closeoutRows(plan({}), [load({}), load({ id: "2", status: "invoiced" }), load({ id: "3", closed_at: "2026-09-01" })], now).map((l) => l.id)).toEqual(["1"]);
  });
  it("closeout honors minimum days since delivery", () => {
    const now = new Date("2026-08-15").getTime();
    expect(closeoutRows(plan({ minDaysSinceDelivery: 30 }), [load({})], now)).toHaveLength(0);
  });
  it("paid_mismatch keeps only invoices paid in QuickBooks", () => {
    const inv = (id: string, balance: number) => ({ id, docNumber: id, date: "2026-08-02", customer: "Peak City Lumber", total: 775, balance, lines: [], text: "" });
    const rows = matchRows(plan({ mode: "paid_mismatch" }), [inv("a", 0), inv("b", 775)], []);
    expect(rows.map((r) => r.invoice.id)).toEqual(["a"]);
  });
});
