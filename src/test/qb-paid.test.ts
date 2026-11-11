import { describe, it, expect } from "vitest";
import { paidLoadIds } from "@/lib/qbPaid";
describe("paidLoadIds", () => {
  it("zero balance counts as paid", () => expect([...paidLoadIds([{ loadId: "a", qbRef: "1", balance: 0 }])]).toEqual(["a"]));
  it("open balance is not paid", () => expect(paidLoadIds([{ loadId: "a", qbRef: "1", balance: 50 }]).size).toBe(0));
  it("missing QB invoice is not paid", () => expect(paidLoadIds([{ loadId: "a", qbRef: "1", balance: null }]).size).toBe(0));
  it("every linked invoice must be paid", () => expect(paidLoadIds([{ loadId: "a", qbRef: "1", balance: 0 }, { loadId: "a", qbRef: "2", balance: 10 }]).size).toBe(0));
});
