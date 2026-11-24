import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn(), update: vi.fn(), upsert: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: db.from } }));
import { initialTrackingContact, saveTrackingDriver } from "@/lib/trackingDrivers";
beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [db.from, db.insert, db.update, db.upsert, db.eq, db.select]) fn.mockReturnValue(db);
  db.single.mockResolvedValue({ data: { id: "saved-driver" }, error: null });
});
describe("saved tracking driver rules", () => {
  it("fills the assigned fleet driver's name and number, not another driver's", () => {
    expect(initialTrackingContact(null, "our-driver", [
      { id: "other", name: "Other driver", phone: "3365550101" },
      { id: "our-driver", name: "Fleet driver", phone: "3365550100" },
    ])).toEqual({ name: "Fleet driver", phone: "3365550100" });
  });
  it("does not guess a driver when none is assigned", () => {
    expect(initialTrackingContact(null, null, [{ id: "repeat", name: "Repeat driver", phone: "3365550100" }])).toEqual({ name: "", phone: "" });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("keeps the active tracking recipient instead of replacing it with the fleet assignment", () => {
    expect(initialTrackingContact({ name: "Actual driver", phone: "3365550101" }, "fleet", [{ id: "fleet", name: "Fleet driver", phone: "3365550100" }])).toEqual({ name: "Actual driver", phone: "3365550101" });
  });
  it("explicitly saves a repeat driver only for the assigned carrier and deduplicates normalized phones", async () => {
    await saveTrackingDriver({ name: "Repeat driver", phone: "(336) 555-0100" }, { fleet: false, carrierId: "known-carrier", selectedId: null });
    expect(db.from).toHaveBeenCalledWith("carrier_tracking_drivers");
    expect(db.upsert).toHaveBeenCalledWith({ carrier_id: "known-carrier", driver_name: "Repeat driver", driver_phone: "+13365550100" }, { onConflict: "carrier_id,driver_phone" });
  });
  it("updates the selected fleet driver's existing record", async () => {
    await saveTrackingDriver({ name: "Fleet driver", phone: "3365550100" }, { fleet: true, carrierId: null, selectedId: "our-driver" });
    expect(db.from).toHaveBeenCalledWith("drivers");
    expect(db.update).toHaveBeenCalledWith({ full_name: "Fleet driver", phone: "+13365550100" });
    expect(db.eq).toHaveBeenCalledWith("id", "our-driver");
    expect(db.upsert).not.toHaveBeenCalled();
  });
  it("requires a known carrier before saving an external driver", async () => {
    await expect(saveTrackingDriver({ name: "Driver", phone: "3365550100" }, { fleet: false, carrierId: null, selectedId: null })).rejects.toThrow("Assign a carrier");
    expect(db.from).not.toHaveBeenCalled();
  });
  it("rejects invalid phone numbers without storing a contact", async () => {
    await expect(saveTrackingDriver({ name: "Driver", phone: "123" }, { fleet: false, carrierId: "carrier", selectedId: null })).rejects.toThrow("valid phone");
    expect(db.from).not.toHaveBeenCalled();
  });
  it("scopes repeat-driver corrections to that carrier", async () => {
    await saveTrackingDriver({ name: "Repeat driver", phone: "3365550101" }, { fleet: false, carrierId: "carrier", selectedId: "repeat" });
    expect(db.eq.mock.calls).toEqual([["id", "repeat"], ["carrier_id", "carrier"]]);
    expect(db.update).toHaveBeenCalledWith({ carrier_id: "carrier", driver_name: "Repeat driver", driver_phone: "+13365550101" });
  });
});