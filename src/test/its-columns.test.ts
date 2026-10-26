import { describe, expect, it } from "vitest";
import { resolveColumns } from "@/components/ItsSync";

describe("ITS column matching", () => {
  it("reads the classic ITS report headings", () => {
    const idx = resolveColumns(["Load #", "Ship/Date", "Del/Date", "Origin", "Destination", "PO Numbers", "W/O #", "Revenue", "Carrier Pay"]);
    expect([idx.its, idx.ship, idx.del, idx.origin, idx.dest, idx.po, idx.wo, idx.revenue, idx.carrierPay]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("reads a flat export with split city/state and customer columns", () => {
    const idx = resolveColumns(["Load #", "Customer", "Pickup Date", "Delivery Date", "Origin City", "Origin State", "Destination City", "Destination State", "Carrier", "Carrier MC", "Customer Rate", "Carrier Rate", "W/O"]);
    expect(idx.customer).toBe(1);
    expect(idx.ship).toBe(2);
    expect(idx.del).toBe(3);
    expect([idx.originCity, idx.originState, idx.destCity, idx.destState]).toEqual([4, 5, 6, 7]);
    expect(idx.carrier).toBe(8);
    expect(idx.mc).toBe(9);
    expect(idx.revenue).toBe(10);
    expect(idx.carrierPay).toBe(11);
    expect(idx.wo).toBe(12);
  });
});
