import { describe, expect, it } from "vitest";
import { rangeFor } from "@/lib/dateRanges";
import { scoreMatch, type QbInvoice, type MatchLoad } from "@/lib/qbMatch";

const now = new Date(2026, 9, 18);
describe("date ranges", () => {
  it("year to date runs Jan 1 to today", () => expect(rangeFor("ytd", now)).toEqual(["2026-01-01", "2026-10-18"]));
  it("a chosen year covers the whole year", () => expect(rangeFor("year_2024", now)).toEqual(["2024-01-01", "2024-12-31"]));
  it("last quarter is Q3", () => expect(rangeFor("last_quarter", now)).toEqual(["2026-07-01", "2026-09-30"]));
});

describe("QuickBooks matching", () => {
  const load: MatchLoad = { id: "1", load_number: "CW-1", customer: "Acme Foods", customer_rate: 1500, origin_city: "Raleigh", origin_state: "NC", dest_city: "Atlanta", dest_state: "GA", delivery_at: "2026-03-01", pickup_at: null };
  const inv: QbInvoice = { id: "9", docNumber: "5521", date: "2026-03-03", customer: "Acme Foods, Inc.", total: 1500, balance: 0, lines: [], text: "Raleigh NC to Atlanta GA" };
  it("customer + amount + cities is a high match", () => expect(scoreMatch(inv, load).level).toBe("high"));
  it("different amount and customer is weak", () => expect(scoreMatch({ ...inv, customer: "Other", total: 900, text: "" }, load).level).toBe("weak"));
});
