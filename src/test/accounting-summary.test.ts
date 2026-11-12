import { describe, expect, it } from "vitest";
import { agingTotal, carrierAccountingEntries } from "@/lib/accountingSummary";
import { FLEET_CARRIER_ID, type Load } from "@/lib/tms";
import type { PayCarrier } from "@/lib/carrierPay";

const at = "2026-11-01T12:00:00Z";
const load = (o: Partial<Load> = {}) => ({ id: "a", carrier_id: "c", status: "invoiced", carrier_rate: 2000, accessorials: [], pod_received: true, pod_received_at: at, created_at: at, carrier_paid_at: null, ...o }) as Load;
const carriers = new Map([["c", { id: "c", pay_terms: "quickpay", quickpay_fee_pct: null } as PayCarrier]]);

describe("Accounting totals", () => {
  it("includes the $1,900 payable without a queued QB bill", () => {
    const [entry] = carrierAccountingEntries([load()], carriers, new Set());
    expect(entry?.owed).toBe(true);
    expect(entry?.pay.net).toBe(1900);
  });
  it("customer paid does not settle the carrier", () => {
    expect(carrierAccountingEntries([load({ status: "paid" })], carriers, new Set())[0]?.owed).toBe(true);
  });
  it("carrier paid removes AP and makes the $100 fee collected", () => {
    const [entry] = carrierAccountingEntries([load({ carrier_paid_at: at })], carriers, new Set());
    expect(entry?.owed).toBe(false);
    expect(entry?.collected).toBe(true);
    expect(entry?.pay.fee).toBe(100);
  });
  it("keeps the selected 2.5% fee instead of resetting to 5%", () => {
    expect(carrierAccountingEntries([load({ quickpay_fee_pct: 2.5 })], carriers, new Set())[0]?.pay.fee).toBe(50);
  });
  it("older invoiced loads without POD are included", () => {
    expect(carrierAccountingEntries([load({ status: "delivered", pod_received: false })], carriers, new Set(["a"]))[0]?.owed).toBe(true);
  });
  it("excludes cancelled and internal fleet loads", () => {
    expect(carrierAccountingEntries([load({ status: "cancelled" }), load({ carrier_id: FLEET_CARRIER_ID })], carriers, new Set())).toHaveLength(0);
  });
  it("ages and totals the same detail rows", () => {
    expect(agingTotal([{ amount: 100, age: 30 }, { amount: 200, age: 60 }, { amount: 300, age: 61 }])).toEqual({ total: 600, a: 100, b: 200, c: 300 });
  });
});