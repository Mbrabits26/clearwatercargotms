import { describe, expect, it } from "vitest";
import { parseEldPayload, normalizeDuty, sameId } from "./eld";

describe("eld payload", () => {
  it("reads a wrapped vehicle list with nested location", () => {
    const r = parseEldPayload({ vehicles: [{ vehicle_number: "101", location: { latitude: "35.78", longitude: -79.55, speed: 62 }, duty_status: "D" }] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ unit: "101", lat: 35.78, lng: -79.55, speed_mph: 62, duty_status: "driving" });
  });
  it("drops entries without a unit and blanks 0,0 coordinates", () => {
    const r = parseEldPayload([{ lat: 1, lng: 1 }, { unit: "7", lat: 0, lng: 0 }]);
    expect(r).toHaveLength(1);
    expect(r[0].lat).toBeNull();
  });
  it("converts unix seconds", () => {
    expect(parseEldPayload({ unit: "1", timestamp: 1700000000 })[0].recorded_at).toBe("2023-11-14T22:13:20.000Z");
  });
  it("matches ids ignoring case and spaces", () => {
    expect(sameId("Truck 101", "truck101")).toBe(true);
    expect(normalizeDuty("SB")).toBe("sleeper");
  });
});
