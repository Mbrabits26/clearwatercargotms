import { describe, it, expect } from "vitest";
import { shouldAutoDeliver } from "./podAutoDeliver";

const base = { status: "rolling", pod_received: true, customer_id: "c", carrier_id: "k", truck_id: null, closed_at: null };

describe("shouldAutoDeliver", () => {
  it("delivers when a signed POD is on file", () => {
    expect(shouldAutoDeliver(base)).toBe(true);
  });
  it("never auto-delivers without a signed POD", () => {
    expect(shouldAutoDeliver({ ...base, pod_received: false })).toBe(false);
  });
  it("works for dispatched and booked loads too", () => {
    expect(shouldAutoDeliver({ ...base, status: "dispatched" })).toBe(true);
    expect(shouldAutoDeliver({ ...base, status: "booked" })).toBe(true);
  });
  it("never moves loads that are already further along or cancelled", () => {
    for (const status of ["delivered", "invoiced", "paid", "cancelled", "issue", "available"]) {
      expect(shouldAutoDeliver({ ...base, status })).toBe(false);
    }
  });
  it("company-truck loads qualify without a carrier", () => {
    expect(shouldAutoDeliver({ ...base, carrier_id: null, truck_id: "t" })).toBe(true);
  });
  it("needs a customer and a carrier or truck", () => {
    expect(shouldAutoDeliver({ ...base, customer_id: null })).toBe(false);
    expect(shouldAutoDeliver({ ...base, carrier_id: null, truck_id: null })).toBe(false);
  });
});
