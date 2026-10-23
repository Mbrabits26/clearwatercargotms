import { describe, expect, it } from "vitest";
import { buildReportPdf, pdfSafe, reportCsv, type ReportSpec } from "@/lib/reportExport";

const spec: ReportSpec = {
  title: "Outstanding customer invoices",
  filters: ["Pickup dates: All dates"],
  summary: [["Loads", "2"]],
  head: ["Load", "Customer", "Amount"],
  rows: [{ group: "Peak City Lumber" }, ["CW-1", 'Acme "East"', "$1,000.00"], { subtotal: ["Subtotal", "", "$1,000.00"] }],
  total: ["Grand total", "", "$1,000.00"],
};

describe("report export", () => {
  it("CSV keeps title, filters, table header, rows and grand total, escaping quotes", () => {
    const lines = reportCsv(spec).split("\r\n");
    expect(lines[0]).toBe('"Outstanding customer invoices"');
    expect(lines).toContain('"Pickup dates: All dates"');
    expect(lines).toContain('"Load","Customer","Amount"');
    expect(lines).toContain('"CW-1","Acme ""East""","$1,000.00"');
    expect(lines.at(-1)).toBe('"Grand total","","$1,000.00"');
  });

  it("PDF text swaps arrows for 'to' so lanes print", () => {
    expect(pdfSafe("Staley, NC → Richmond, VA")).toBe("Staley, NC to Richmond, VA");
  });

  it("long reports continue onto more pages", () => {
    const many = { ...spec, rows: Array.from({ length: 200 }, (_, i) => [`CW-${i}`, "Customer", "$1.00"]) };
    expect(buildReportPdf(many).getNumberOfPages()).toBeGreaterThan(1);
  });
});
