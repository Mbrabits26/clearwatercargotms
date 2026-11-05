import { describe, it, expect } from "vitest";
import { scoreReport } from "./carrierCheck";

const base = {
  dot: "1", mc: null, generated_at: "", legal_name: "X", dba: null, status: "Active", authority_status: "Authorized", safety_rating: "Satisfactory",
  safety_rating_date: null, review: null, entity: null, operation: null, classification: null, cargo: [], address: null, mailing: null, phone: null,
  email: null, contact: null, added: "20150101", mcs150_date: "20260101", mcs150_mileage: null, power_units: 10, drivers: 10, owned_tractors: null,
  owned_trailers: null, hazmat: false, interstate: true, bipd_on_file: 750000, bipd_required: 750000, cargo_on_file: null,
  insp: { total: 10, vehicle: 10, driver: 10, hazmat: 0, vehicle_oos: 1, driver_oos: 0, hazmat_oos: 0, violations: 2 },
  crashes: { total: 0, fatal: 0, injury: 0, tow: 0 }, recent_inspections: [], recent_crashes: [], top_violations: [],
};
const now = new Date("2026-11-05T00:00:00Z");

describe("carrier check scoring", () => {
  it("clean established carrier is low risk", () => expect(scoreReport(base, now).grade).toBe("Low risk"));
  it("vehicle OOS 42.9% is high risk", () => {
    const r = scoreReport({ ...base, insp: { ...base.insp, vehicle: 7, vehicle_oos: 3 } }, now);
    expect(r.grade).toBe("High risk");
  });
  it("DOT under 6 months is a red flag", () => {
    expect(scoreReport({ ...base, added: "20260801" }, now).flags.some((f) => f.level === "red")).toBe(true);
  });
  it("conditional rating needs review", () => expect(scoreReport({ ...base, safety_rating: "Conditional" }, now).grade).toBe("Review"));
});
