import { describe, expect, it } from "vitest";
import { bidSheetRows, bidStatusFromLanes, counterLadder, defaultFieldMap, detectBelowPct, detectOrigin, estimateCarrierCost, findTables, guessMapping, laneOutValues, laneTotals, parseBand, priceLane, rowsToLanes, sheetNotes, sheetWrites, splitPlace, volumeToWeekly } from "@/lib/bidDesk";

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

describe("reading a state-CPM / mileage-band carrier sheet", () => {
  // Same layout as the customer's Q4 contract-rates workbook.
  const sheet1: unknown[][] = [
    ["State", "Negotiation Start CPM", "Counteroffer 1", "Counteroffer 2", "Final Agreed Rate", "", "Mileage Band", "Negotiation Start Rate", "Counteroffer 1", "Counteroffer 2", "Final Agreed Rate"],
    ["AL", 2.295, "", "", "", "", "0-25", 340, "", "", ""],
    ["GA", 2.7625, "", "", "", "", "301-higher", "", "", "", ""],
  ];
  const sheet2: unknown[][] = [
    ["Destination", "State", "Mileage from Lexington, NC", "Mileage Band", "Negotiation Start CPM", "Counteroffer 1", "Counteroffer 2", "Counteroffer 3", "Final Agreed Rate"],
    ["Greensboro", "NC", "35 mi", "26-50", 11.57, "", "", "", ""],
    ["Opening Q4 State CPM is calculated at 15% below the Q4 State CPM to establish an initial negotiation position.", "", "", "", "", "", "", "", ""],
  ];

  it("splits side-by-side tables and maps the shipper's offer and counter columns", () => {
    const t = findTables(sheet1, "STATE RATES");
    expect(t).toHaveLength(2);
    expect(t[0]!.table.out).toMatchObject({ counter1: "Counteroffer 1", counter2: "Counteroffer 2", final: "Final Agreed Rate" });
    const lanes = rowsToLanes(t[0]!.rows, defaultFieldMap(t[0]!.table.headers, "Lexington, NC"));
    expect(lanes[0]).toMatchObject({ origin_city: "Lexington", origin_state: "NC", dest_state: "AL", offer_rpm: 2.295, source_row: 1 });
    const bands = rowsToLanes(t[1]!.rows, defaultFieldMap(t[1]!.table.headers, "Lexington, NC"));
    expect(bands[0]).toMatchObject({ mileage_band: "0-25", miles: 25, offer_flat: 340, dest_state: "" });
  });

  it("finds the origin in a heading and the opening-offer discount in a note", () => {
    expect(detectOrigin(["Mileage from Lexington, NC"])).toBe("Lexington, NC");
    expect(detectBelowPct(sheetNotes(sheet2))).toBe(15);
    const [t] = findTables(sheet2, "TOP 5");
    const lanes = rowsToLanes(t!.rows, defaultFieldMap(t!.table.headers, "Lexington, NC"));
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({ dest_city: "Greensboro", dest_state: "NC", miles: 35, offer_rpm: 11.57 });
  });

  it("lets a typed value stand in for a missing column", () => {
    const lanes = rowsToLanes([{ St: "GA" }], { origin: { fixed: "Staley, NC" }, dest_state: "St", equipment: { fixed: "Flatbed" } });
    expect(lanes[0]).toMatchObject({ origin_city: "Staley", origin_state: "NC", dest_state: "GA", equipment: "Flatbed" });
  });

  it("reads mileage bands", () => {
    expect(parseBand("26-50")).toEqual({ lo: 26, hi: 50 });
    expect(parseBand("301-higher")).toEqual({ lo: 301, hi: null });
  });
});

describe("counteroffer ladder", () => {
  it("opens at the target margin and walks away at the 8% floor or their offer", () => {
    // cost $2.00/mi: 15% target = 2.35, 8% floor = 2.17
    const l = counterLadder({ offer: 2.0, cost: 2.0, targetPct: 15 });
    expect(l.verdict).toBe("counter");
    expect(l.counters).toEqual([2.35, 2.26, 2.17]);
  });
  it("caps counter 1 at the shipper's likely budget when the sheet says the offer is 15% low", () => {
    const l = counterLadder({ offer: 1.9, cost: 2.0, targetPct: 15, belowPct: 15 });
    expect(l.budget).toBe(2.24); // 1.90 ÷ 0.85
    expect(l.counters[0]).toBe(2.24);
  });
  it("says take it when the offer already beats the target", () => {
    expect(counterLadder({ offer: 2.5, cost: 2.0, targetPct: 15 }).verdict).toBe("take");
  });
  it("says walk away when even their budget is under the floor", () => {
    expect(counterLadder({ offer: 1.5, cost: 2.0, targetPct: 15, belowPct: 10 }).verdict).toBe("walk");
  });
  it("sends counters back as dollars for flat-rate offers and $/mi otherwise", () => {
    expect(laneOutValues({ miles: 50, offer_flat: 405, counters: [9.5] }, 0).counter1).toBe(475);
    expect(laneOutValues({ miles: 35, offer_rpm: 11.57, counters: [12.345] }, 0).counter1).toBe(12.35);
  });
  it("writes into the shipper's own cells", () => {
    const table = { key: "k", sheet: "S", label: "S", headerRow: 0, cols: [6, 7, 8], headers: ["Mileage Band", "Start", "Counteroffer 1"], out: { counter1: "Counteroffer 1" } };
    expect(sheetWrites([table], [{ source_table: "k", source_row: 3, miles: 50, offer_flat: 405, counters: [9.5] }], 0)).toEqual([{ path: null, sheet: "S", r: 3, c: 8, v: 475 }]);
  });
});

describe("placeText (miles lookup address)", () => {
  it("turns a state-only stop into the full state name so it can be routed", async () => {
    const { placeText } = await import("@/lib/bidDesk");
    expect(placeText("", "AL", null)).toBe("Alabama, USA");
    expect(placeText(null, "nc", null)).toBe("North Carolina, USA");
  });
  it("keeps city + state and prefers the zip", async () => {
    const { placeText } = await import("@/lib/bidDesk");
    expect(placeText("Lexington", "NC", null)).toBe("Lexington, NC");
    expect(placeText("Lexington", "NC", "27292")).toBe("27292");
  });
});
