import { describe, expect, it } from "vitest";
import { loadActSkip, statusWarnings } from "@/lib/bulkStatus";
import { FLEET_CARRIER_ID } from "@/lib/tms";

const base = { status: "delivered" as const, closed_at: null, pod_received: false, carrier_paid_at: null, carrier_id: "c1", truck_id: null, driver_id: null };

describe("List bulk actions", () => {
  it("only closes out delivered, invoiced or paid loads", () => {
    expect(loadActSkip({ ...base, status: "paid" }, "closeout")).toBeNull();
    expect(loadActSkip({ ...base, status: "dispatched" }, "closeout")).not.toBeNull();
    expect(loadActSkip({ ...base, closed_at: "2026-01-01" }, "closeout")).not.toBeNull();
  });
  it("never marks company-truck loads carrier paid", () => {
    expect(loadActSkip({ ...base, carrier_id: FLEET_CARRIER_ID }, "carrier_paid")).not.toBeNull();
    expect(loadActSkip({ ...base, truck_id: "t1" }, "carrier_paid")).not.toBeNull();
  });
  it("skips carriers already marked paid and undelivered loads", () => {
    expect(loadActSkip({ ...base, carrier_paid_at: "2026-01-01" }, "carrier_paid")).not.toBeNull();
    expect(loadActSkip({ ...base, status: "rolling" }, "carrier_paid")).not.toBeNull();
    expect(loadActSkip(base, "carrier_paid")).toBeNull();
  });
  it("logs check calls only on loads still moving", () => {
    expect(loadActSkip({ ...base, status: "rolling" }, "checkcall")).toBeNull();
    expect(loadActSkip(base, "checkcall")).not.toBeNull();
  });
  it("skips cancelled loads for every action", () => expect(loadActSkip({ ...base, status: "cancelled" }, "pod")).not.toBeNull());
  it("warns that Invoiced status does not create an invoice", () =>
    expect(statusWarnings([base], "invoiced", "Invoiced").join(" ")).toMatch(/does not create or send an invoice/));
});
