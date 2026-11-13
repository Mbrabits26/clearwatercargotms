import { describe, expect, it } from "vitest";
import { correctionPlan } from "../lib/qbCorrection";

const a = { id: "a", kind: "fleet_invoice", invoice_number: "2165", qb_ref: "5048" };
const b = { id: "b", kind: "fleet_invoice", invoice_number: "FF-1018", qb_ref: "5094" };
const qb = (id: string, docNumber: string) => ({ id, docNumber, customer: "Madison Wood", total: 1625, balance: 0, date: "2026-11-13", text: "40115924", lines: [] });
describe("invoice correction choices", () => {
  it("leaves an incorrect link blank without allocating a new FF number", () => {
    expect(correctionPlan([a], "a", null, "blank", "fleet_invoice")[0]).toMatchObject({ qbRef: null, number: null, allocate: false, status: "hold" });
  });
  it("allocates a new FF number only when explicitly chosen, without sending", () => {
    expect(correctionPlan([a], "a", null, "new", "fleet_invoice")[0]).toMatchObject({ kind: "fleet_invoice", qbRef: null, allocate: true, status: "hold" });
  });
  it("allows an explicit new Clearwater invoice", () => {
    expect(correctionPlan([a], "a", null, "new", "invoice")[0]).toMatchObject({ kind: "invoice", allocate: true, status: "hold" });
  });
  it("swaps two verified invoices without altering payment or amount fields", () => {
    const plan = [...correctionPlan([a], "a", qb("5094", "FF-1018"), "existing", "fleet_invoice"), ...correctionPlan([b], "b", qb("5048", "2165"), "previous", "fleet_invoice")];
    expect(plan.map((r) => [r.id, r.qbRef, r.number])).toEqual([["a", "5094", "FF-1018"], ["b", "5048", "2165"]]);
    for (const r of plan) { expect(r).not.toHaveProperty("amount"); expect(r).not.toHaveProperty("paid"); expect(r).not.toHaveProperty("closed_at"); }
  });
  it("moves the invoice while leaving the displaced load blank", () => {
    expect([...correctionPlan([a], "a", qb("5094", "FF-1018"), "existing", "fleet_invoice"), ...correctionPlan([b], "b", null, "blank", "fleet_invoice")].map((r) => r.qbRef)).toEqual(["5094", null]);
  });
  it("rejects an unverified replacement and cross-company existing links", () => {
    expect(() => correctionPlan([a], "a", null, "previous", "fleet_invoice")).toThrow("Verify");
    expect(() => correctionPlan([a], "a", qb("5094", "FF-1018"), "existing", "invoice")).toThrow("company");
  });
});