import { describe, expect, it } from "vitest";
import { lateDelivery, latePickup, sortForBoard, type Load } from "@/lib/tms";

const L = (status: string, pickup_at: string | null = null, delivery_at: string | null = null) => ({ status, pickup_at, delivery_at } as unknown as Load);

describe("Dispatch board priority", () => {
  it("puts available before booked, dispatched, in transit, then delivered", () => {
    const sorted = sortForBoard([L("delivered"), L("rolling"), L("dispatched"), L("available"), L("booked")]);
    expect(sorted.map((l) => l.status)).toEqual(["available", "booked", "dispatched", "rolling", "delivered"]);
  });
  it("orders same-status loads by earliest pickup", () => {
    const a = L("available", "2026-10-22T14:00:00Z"), b = L("available", "2026-10-21T14:00:00Z");
    expect(sortForBoard([a, b])).toEqual([b, a]);
  });
});

describe("Late pickup / delivery alerts", () => {
  const now = new Date("2026-10-21T18:00:00").getTime();
  it("flags a booked load past its pickup appointment", () => {
    expect(latePickup(L("booked", new Date("2026-10-21T10:00:00").toISOString()), now)).toBe(true);
  });
  it("does not flag a load that already picked up", () => {
    expect(latePickup(L("rolling", new Date("2026-10-21T10:00:00").toISOString()), now)).toBe(false);
  });
  it("flags an in-transit load past its delivery appointment", () => {
    expect(lateDelivery(L("rolling", null, new Date("2026-10-21T09:00:00").toISOString()), now)).toBe(true);
  });
  it("does not flag delivered loads", () => {
    expect(lateDelivery(L("delivered", null, new Date("2026-10-20T09:00:00").toISOString()), now)).toBe(false);
  });
});
