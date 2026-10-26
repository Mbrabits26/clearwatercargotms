import { describe, it, expect } from "vitest";
import { crossCheck, type CrossLoad } from "@/lib/reviewAssistant";
import type { QbInvoice } from "@/lib/qbMatch";

const load = (id: string, status: string, rate: number, ref?: string): CrossLoad => ({ id, load_number: `CW-${id}`, customer: "Peak City Lumber", customer_rate: rate, status,
  origin_city: "Staley", origin_state: "NC", dest_city: "Raleigh", dest_state: "NC", delivery_at: "2026-03-01", pickup_at: "2026-02-28", customer_ref: ref ?? null, ship_ref: null });
const inv = (id: string, total: number, text = ""): QbInvoice => ({ id, docNumber: id, date: "2026-03-02", customer: "Peak City Lumber LLC", total, balance: 0, lines: [], text });

describe("TMS vs QuickBooks check", () => {
  it("lists a delivered load that QuickBooks already invoiced", () => {
    const r = crossCheck([inv("2673", 775)], [load("1", "delivered", 775)]);
    expect(r.qbOnly.map((x) => x.match.load.id)).toEqual(["1"]);
    expect(r.tmsOnly).toEqual([]);
  });
  it("lists a load with no QuickBooks invoice as not invoiced", () => {
    const r = crossCheck([inv("2673", 999)], [load("1", "delivered", 775)]);
    expect(r.qbOnly).toEqual([]);
    expect(r.tmsOnly.map((l) => l.id)).toEqual(["1"]);
  });
  it("never pairs one invoice with two loads", () => {
    const r = crossCheck([inv("2673", 775, "Ref ABC123")], [load("1", "delivered", 775), load("2", "delivered", 775, "ABC123")]);
    expect(r.qbOnly.map((x) => x.match.load.id)).toEqual(["2"]);
    expect(r.tmsOnly.map((l) => l.id)).toEqual(["1"]);
  });
  it("ignores loads already invoiced, paid or without a carrier", () => {
    const r = crossCheck([], [load("1", "invoiced", 1), load("2", "paid", 1), load("3", "available", 1)]);
    expect(r.tmsOnly).toEqual([]);
  });
});
