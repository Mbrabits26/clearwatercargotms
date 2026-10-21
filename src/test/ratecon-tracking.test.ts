import { describe, expect, it } from "vitest";
import { applyTrackingFee, TRACKING_LABEL, type RateConData } from "@/lib/ratecon";

const rateCon = (amount = 1500): RateConData => ({
  rc: "CW-TEST", shipRef: "", destRef: "", date: "10/17/2026",
  lane: "Raleigh to Charlotte", pickup: "", delivery: "", carrier: "Test carrier",
  carrierMc: "", equipment: "Van", customer: "Test customer", terms: "Net 30", remitTo: "Test carrier",
  lines: [{ label: "Linehaul", amount }], total: amount,
  shipper: { name: "", addr: "", cityLine: "", phone: "" },
  consignee: { name: "", addr: "", cityLine: "", phone: "" },
  commodity: "", type: "", weight: null, qty: null, hazmat: "", notes: "",
});

describe("Tracking fee within the agreed carrier rate", () => {
  it("splits $1,500 into $1,300 linehaul and $200 tracking without changing total", () => {
    const result = applyTrackingFee(rateCon(), true);
    expect(result.lines).toEqual([{ label: "Linehaul", amount: 1300 }, { label: TRACKING_LABEL, amount: 200 }]);
    expect(result.total).toBe(1500);
  });
  it("applies the same $200 split to other rates and preserves accessorials", () => {
    const input = rateCon(1875.25);
    input.lines.push({ label: "Detention", amount: 75 });
    const result = applyTrackingFee(input, true);
    expect(result.lines).toEqual([{ label: "Linehaul", amount: 1675.25 }, { label: TRACKING_LABEL, amount: 200 }, { label: "Detention", amount: 75 }]);
    expect(result.total).toBe(1950.25);
    expect(input.lines[0]?.amount).toBe(1875.25);
  });
  it("customer $2,500 / carrier $2,300 prints $2,100 linehaul + $200 fee = $2,300, not $2,500", () => {
    const result = applyTrackingFee(rateCon(2300), true);
    expect(result.lines).toEqual([{ label: "Linehaul", amount: 2100 }, { label: TRACKING_LABEL, amount: 200 }]);
    expect(result.total).toBe(2300);
  });
  it("treats the older 'Tracking fee' label as the same fee", () => {
    const old = rateCon(2100);
    old.lines.push({ label: "Tracking fee", amount: 200 });
    expect(applyTrackingFee(old, false).lines).toEqual([{ label: "Linehaul", amount: 2300 }]);
  });
  it("does not deduct the fee twice when reviewing or resending", () => {
    const split = applyTrackingFee(rateCon(), true);
    expect(applyTrackingFee(split, true)).toEqual(split);
  });
  it("restores the full agreed linehaul when tracking is unchecked", () => {
    const result = applyTrackingFee(applyTrackingFee(rateCon(), true), false);
    expect(result.lines).toEqual([{ label: "Linehaul", amount: 1500 }]);
    expect(result.total).toBe(1500);
    expect(result.tracking).toBe(false);
  });
});