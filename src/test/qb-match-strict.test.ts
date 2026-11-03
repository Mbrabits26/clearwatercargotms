import { describe, expect, it } from "vitest";
import { bestMatches, planMatches, scoreMatch, type MatchLoad, type QbInvoice } from "@/lib/qbMatch";
import { crossCheck, type CrossLoad } from "@/lib/reviewAssistant";

const load = (id: string, extra: Partial<MatchLoad> = {}): MatchLoad => ({ id, load_number: `CW-${id}`, customer: "Peak City Lumber", customer_rate: 775,
  origin_city: "Staley", origin_state: "NC", dest_city: "Raleigh", dest_state: "NC", delivery_at: "2026-03-01", pickup_at: null, ...extra });
const inv = (id: string, extra: Partial<QbInvoice> = {}): QbInvoice => ({ id, docNumber: id, date: "2026-03-02", customer: "Peak City Lumber LLC", total: 775, balance: 0, lines: [], text: "", ...extra });

describe("stricter QuickBooks matching", () => {
  it("two loads with the same customer and rate are a tie, never picked automatically", () => {
    const m = bestMatches(inv("2673"), [load("1"), load("2")]);
    expect(m[0]!.tie).toBe(true);
    const r = crossCheck([inv("2673")], [{ ...load("1"), status: "delivered" }, { ...load("2"), status: "delivered" }] as CrossLoad[]);
    expect(r.qbOnly).toEqual([]);
  });
  it("a different customer with the same amount is weak", () => {
    expect(scoreMatch(inv("9", { customer: "Madison Wood Preservers" }), load("1")).level).toBe("weak");
  });
  it("flags a second QuickBooks invoice for the same load as a possible double", () => {
    const p = planMatches([inv("2673", { text: "CW-1 freight" }), inv("2690", { text: "CW-1 freight" })], [load("1")]);
    const flagged = [...p.values()].filter((x) => x.doubleOf);
    expect(flagged).toHaveLength(1);
    expect([...p.values()].filter((x) => x.best?.load.id === "1")).toHaveLength(1);
  });
  it("never suggests one load for two invoices", () => {
    const p = planMatches([inv("A", { text: "Ref PO55" }), inv("B")], [load("1", { customer_ref: "PO55" }), load("2", { customer_rate: 900 })]);
    expect(p.get("A")!.best!.load.id).toBe("1");
    expect(p.get("B")!.best?.load.id).not.toBe("1");
  });
});
