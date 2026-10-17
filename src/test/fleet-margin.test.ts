import { describe, expect, it } from "vitest";
import { FLEET_CARRIER_ID, loadTotals, type Load } from "@/lib/tms";

const base = { customer_rate: 2000, carrier_rate: 1500, accessorials: [], truck_id: null, driver_id: null, carrier_id: null } as unknown as Load;

describe("Foust Farms loads have no margin", () => {
  it("brokered load keeps its margin", () => {
    expect(loadTotals(base).margin).toBe(500);
  });
  it("load on the Foust Farms carrier record has zero margin", () => {
    const t = loadTotals({ ...base, carrier_id: FLEET_CARRIER_ID } as Load);
    expect(t.margin).toBe(0);
    expect(t.pct).toBe(0);
  });
  it("load on a company truck has zero margin", () => {
    expect(loadTotals({ ...base, truck_id: "t1" } as Load).margin).toBe(0);
  });
});
