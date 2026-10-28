import { describe, expect, it } from "vitest";
import { entryForLane, fscForPrice, fscFormula, linehaulKeepingAllIn, parseFscPaste, parseFuelPosting } from "./fscPaste";

describe("parseFscPaste", () => {
  it("reads one rate for every lane", () => {
    expect(parseFscPaste("$0.62")).toEqual({ kind: "single", rpm: 0.62 });
  });
  it("reads one rate per lane copied from a column", () => {
    expect(parseFscPaste("0.55\n0.60\n0.58")).toEqual({ kind: "list", rates: [0.55, 0.6, 0.58] });
  });
  it("reads a range fuel table copied from a spreadsheet", () => {
    const p = parseFscPaste("Diesel price\tFSC/mi\n3.50 - 3.599\t0.45\n3.60 - 3.699\t0.47\n3.70 - 3.799\t0.49");
    expect(p.kind).toBe("schedule");
    if (p.kind === "schedule") expect(p.rows).toEqual([{ min: 3.5, max: 3.599, rpm: 0.45 }, { min: 3.6, max: 3.699, rpm: 0.47 }, { min: 3.7, max: 3.799, rpm: 0.49 }]);
  });
  it("fills ranges for a two-column table", () => {
    const p = parseFscPaste("3.50 0.45\n3.60 0.47");
    if (p.kind !== "schedule") throw new Error(p.kind);
    expect(p.rows[0]).toEqual({ min: 3.5, max: 3.599, rpm: 0.45 });
    expect(p.rows[1]!.max).toBeNull();
  });
  it("rejects percent tables", () => {
    expect(parseFscPaste("3.50 - 3.59 12%\n3.60 - 3.69 13%").kind).toBe("error");
  });
});

describe("fscForPrice", () => {
  const rows = [{ min: 3.5, max: 3.599, rpm: 0.45 }, { min: 3.6, max: 3.699, rpm: 0.47 }];
  it("picks the row the diesel price falls in", () => expect(fscForPrice(rows, 3.65).rpm).toBe(0.47));
  it("no surcharge under the table", () => expect(fscForPrice(rows, 3.2).rpm).toBe(0));
  it("top rate above the table", () => expect(fscForPrice(rows, 4.1).rpm).toBe(0.47));
});

it("formula: (diesel − base) ÷ mpg", () => {
  expect(fscFormula(3.75, 1.25, 6)).toBe(0.417);
  expect(fscFormula(1.0, 1.25, 6)).toBe(0);
});

it("keeping the all-in moves the fuel change out of linehaul", () => {
  expect(linehaulKeepingAllIn(2000, 500, 0.4, 0.5)).toBe(1950);
  expect(linehaulKeepingAllIn(0, 500, 0.4, 0.5)).toBe(0);
});

describe("weekly fuel post", () => {
  const eia = `On-Highway Diesel Fuel Prices (dollars per gallon)
\t10/13/26\t10/20/26\t10/27/26\tweek ago\tyear ago
U.S.\t3.689\t3.665\t3.705\t0.040\t-0.012
East Coast (PADD1)\t3.801\t3.790\t3.822\t0.032\t0.101
New England (PADD1A)\t4.101\t4.090\t4.120\t0.030\t0.050
Lower Atlantic (PADD1C)\t3.650\t3.640\t3.701\t0.061\t0.020
Midwest (PADD2)\t3.600\t3.580\t3.611\t0.031\t-0.040
California\t5.100\t5.050\t5.020\t-0.030\t0.200
West Coast less California\t4.200\t4.180\t4.190\t0.010\t0.030`;
  it("reads the newest week's diesel price for each region", () => {
    const p = parseFuelPosting(eia);
    if ("error" in p) throw new Error(p.error);
    expect(p.kind).toBe("diesel");
    expect(p.weekOf).toBe("2026-10-27");
    const by = Object.fromEntries(p.entries.map((e) => [e.region, e.value]));
    expect(by).toMatchObject({ us: 3.705, east: 3.822, ne: 4.12, latl: 3.701, mw: 3.611, ca: 5.02, wxca: 4.19 });
  });
  it("matches a lane to its pickup region, falling back to the broader region then U.S.", () => {
    const p = parseFuelPosting(eia);
    if ("error" in p) throw new Error(p.error);
    expect(entryForLane(p.entries, { origin_state: "NC" }, "region")?.value).toBe(3.701);
    expect(entryForLane(p.entries, { origin_state: "PA" }, "region")?.value).toBe(3.822); // Central Atlantic not posted → East Coast
    expect(entryForLane(p.entries, { origin_state: "TX" }, "region")?.value).toBe(3.705); // Gulf not posted → U.S.
    expect(entryForLane(p.entries, { origin_state: "WA" }, "region")?.value).toBe(4.19);
  });
  it("can match by the delivery region instead of pickup", () => {
    const p = parseFuelPosting(eia);
    if ("error" in p) throw new Error(p.error);
    const lane = { origin_state: "NC", dest_state: "WA" };
    expect(entryForLane(p.entries, lane, "region", "pickup")?.value).toBe(3.701);
    expect(entryForLane(p.entries, lane, "region", "delivery")?.value).toBe(4.19);
    expect(entryForLane(p.entries, { origin_state: "NC" }, "region", "delivery")?.value).toBe(3.701); // no delivery state → pickup
  });
  it("reads $/mi posted by trailer type", () => {
    const p = parseFuelPosting("Fuel surcharge this week\nDry Van $0.52\nReefer $0.58\nFlatbed $0.61");
    if ("error" in p) throw new Error(p.error);
    expect(p.kind).toBe("fsc");
    expect(entryForLane(p.entries, { equipment: "Reefer" }, "equipment")?.value).toBe(0.58);
    expect(entryForLane(p.entries, { equipment: "Dry Van" }, "equipment")?.value).toBe(0.52);
  });
  it("newest-first date columns use the first price", () => {
    const p = parseFuelPosting("Region 10/27/26 10/20/26\nMidwest 3.61 3.58\nGulf Coast 3.40 3.38");
    if ("error" in p) throw new Error(p.error);
    expect(p.entries.map((e) => e.value)).toEqual([3.61, 3.4]);
  });
});
