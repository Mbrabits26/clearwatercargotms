import { describe, expect, it } from "vitest";
import { consolidateProblem, kindFor } from "@/lib/batchInvoice";
import type { Load } from "@/lib/tms";

const brokered = { id: "a", customer_id: "c1", truck_id: null, driver_id: null, carrier_id: "outside" } as unknown as Load;
const fleet = { id: "b", customer_id: "c1", truck_id: "t1", driver_id: null, carrier_id: null } as unknown as Load;

describe("bill through either company", () => {
  it("defaults outside-carrier loads to Clearwater", () => expect(kindFor(brokered)).toBe("invoice"));
  it("defaults our own trucks to Foust Farms", () => expect(kindFor(fleet)).toBe("fleet_invoice"));
  it("lets a Foust customer be billed by Foust on an outside-carrier load", () => expect(kindFor(brokered, "fleet_invoice")).toBe("fleet_invoice"));
  it("lets a fleet load be billed by Clearwater", () => expect(kindFor(fleet, "invoice")).toBe("invoice"));
  it("blocks combining mixed companies on automatic", () => expect(consolidateProblem([brokered, fleet])).not.toBeNull());
  it("allows combining once one company bills them all", () => expect(consolidateProblem([brokered, fleet], "fleet_invoice")).toBeNull());
});
