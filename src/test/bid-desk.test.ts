import { describe, expect, it } from "vitest";
import { bidSheetRows, bidStatusFromLanes, estimateCarrierCost, guessMapping, laneTotals, priceLane, rowsToLanes, splitPlace, volumeToWeekly } from "@/lib/bidDesk";

describe("bid lane totals", () => {
  it("adds a per-mile fuel surcharge and accessorials to the linehaul", () => {
    const t = laneTotals({ miles: 500, linehaul: 1200, fsc_per_mile: 0.55, accessorials: [{ type: "Tarp", amount: 100 }], carrier_cost: 1300 }, 0);
    expect(t.fsc).toBe(275);
    expect(t.allIn).toBe(1575);
    expect(t.margin).toBe(275);
  });
  it("uses the bid's default FSC per mile when the lane has none", () => {
    expect(laneTotals({ miles: 400, linehaul: 1000 }, 0.6).fsc).toBe(240);
  });
  it("projects contract profit from loads per week", () => {
    const t = laneTotals({ miles: 100, linehaul: 500, carrier_cost: 400, loads_per_week: 2 }, 0);
    expect(t.annualProfit).toBe(100 * 2 * 52);
  });
});

describe("pricing a lane", () => {
  it("takes FSC and accessorials out of the linehaul so the all-in hits the target margin", () => {
    const p = priceLane({ miles: 500, fsc_per_mile: 0.5, accessorials: [{ type: "Stop", amount: 50 }] }, 1700, 0, 15);
    // all-in for 15% on $1,700 = $2,000; minus $250 FSC and $50 stop
    expect(p).toEqual({ carrier_cost: 1700, linehaul: 1700 });
  });
  it("prefers our lane history over the market rate for carrier cost", () => {
    expect(estimateCarrierCost({ miles: 100, market_spot_rpm: 3 }, "spot", 2.5)).toEqual({ cost: 250, source: "history" });
    expect(estimateCarrierCost({ miles: 100, market_spot_rpm: 3, market_contract_rpm: 2.2 }, "contract", null)).toEqual({ cost: 220, source: "market" });
  });
});

describe("bid status from lane results", () => {
  it("won, lost, partial", () => {
    expect(bidStatusFromLanes([{ status: "won" }, { status: "won" }], "submitted")).toBe("won");
    expect(bidStatusFromLanes([{ status: "lost" }], "submitted")).toBe("lost");
    expect(bidStatusFromLanes([{ status: "won" }, { status: "pending" }], "submitted")).toBe("partial");
    expect(bidStatusFromLanes([{ status: "pending" }], "draft")).toBe("draft");
  });
});

describe("reading RFP spreadsheets", () => {
  it("reads volume as loads per week", () => {
    expect(volumeToWeekly("2 per week")).toBe(2);
    expect(volumeToWeekly(104)).toBe(2);
    expect(volumeToWeekly(10, "Monthly Volume")).toBeCloseTo(2.31, 2);
  });
  it("splits combined City, ST zip cells", () => {
    expect(splitPlace("Charlotte, NC 28202")).toEqual({ city: "Charlotte", state: "NC", zip: "28202" });
    expect(splitPlace("Staley NC")).toEqual({ city: "Staley", state: "NC", zip: "" });
  });
  it("maps common RFP headings and returns lanes", () => {
    const headers = ["Lane ID", "Origin City", "Origin State", "Destination", "Equipment Type", "Annual Volume", "Rate"];
    const m = guessMapping(headers);
    expect(m.origin_city).toBe("Origin City");
    expect(m.dest).toBe("Destination");
    expect(m.linehaul).toBe("Rate");
    const lanes = rowsToLanes([{ "Lane ID": 1, "Origin City": "Staley", "Origin State": "nc", Destination: "Atlanta, GA", "Equipment Type": "53' Van", "Annual Volume": 52 }], m);
    expect(lanes[0]).toMatchObject({ origin_state: "NC", dest_city: "Atlanta", dest_state: "GA", equipment: "Dry Van", loads_per_week: 1 });
  });
  it("fills our rate into the shipper's own rate column and adds the rest", () => {
    const out = bidSheetRows(["Lane ID", "Rate"], [{ original: { "Lane ID": 7 }, miles: 100, linehaul: 300, fsc_per_mile: 0.5, origin_city: "", origin_state: "NC", dest_city: "", dest_state: "GA", equipment: "Dry Van" }], 0, { linehaul: "Rate" });
    expect(out.rows[0]!["Rate"]).toBe(300);
    expect(out.rows[0]!["Lane ID"]).toBe(7);
    expect(out.rows[0]!["Clearwater All-in $"]).toBe(350);
  });
});
