import { describe, expect, it } from "vitest";
import { batchEligible, needsWork, type WorkLoad } from "@/lib/loadWork";

const load = (changes: Partial<WorkLoad> = {}): WorkLoad => ({ id: "old-its", load_number: "CW-123", status: "delivered", broker_id: "broker", delivery_at: "2026-01-01T00:00:00Z", source: "its", pod_received: false, closed_at: null, ...changes });
describe("Unfinished loads across all dates", () => {
  it("includes older ITS loads needing invoices", () => expect(needsWork(load(), "invoice", new Set())).toBe(true));
  it("excludes already invoiced loads from invoice notices", () => expect(needsWork(load(), "invoice", new Set(["old-its"]))).toBe(false));
  it("includes overdue imported loads needing delivery", () => expect(needsWork(load({ status: "rolling" }), "delivery", new Set(), Date.parse("2026-10-17"))).toBe(true));
  it("does not claim future delivery is overdue", () => expect(needsWork(load({ status: "rolling", delivery_at: "2027-01-01" }), "delivery", new Set(), Date.parse("2026-10-17"))).toBe(false));
  it("allows operational closeout for delivered historical loads without requiring a duplicate invoice", () => expect(batchEligible(load(), "closeout")).toBe(true));
  it("never offers delivery for invoiced or paid loads", () => {
    expect(batchEligible(load({ status: "invoiced" }), "delivered")).toBe(false);
    expect(batchEligible(load({ status: "paid" }), "delivered")).toBe(false);
  });
  it("removes closed out records from work lists but preserves their delivered status", () => {
    const closed = load({ closed_at: "2026-10-17" });
    expect(needsWork(closed, "invoice", new Set())).toBe(false);
    expect(needsWork(closed, "closed", new Set())).toBe(true);
    expect(closed.status).toBe("delivered");
  });
  it("excludes cancelled records from batch actions", () => {
    expect(batchEligible(load({ status: "cancelled" }), "closeout")).toBe(false);
    expect(batchEligible(load({ status: "cancelled" }), "delivered")).toBe(false);
  });
});