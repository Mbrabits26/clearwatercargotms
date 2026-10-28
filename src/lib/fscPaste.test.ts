import { describe, expect, it } from "vitest";
import { fscForPrice, fscFormula, linehaulKeepingAllIn, parseFscPaste } from "./fscPaste";

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
