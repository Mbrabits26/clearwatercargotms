import { describe, expect, it } from "vitest";
import { manualInvoiceLinkPatch } from "../lib/qbManualLink";
import type { QbInvoice } from "../lib/qbMatch";

const invoice: QbInvoice = { id: "2088", docNumber: "2088", customer: "Madison Wood Preservers", total: 1000, balance: 1000, date: "2026-10-01", text: "", lines: [] };
describe("manual existing invoice assignment", () => {
  it("replaces FF-1017's stale 5093 reference with verified 2088 and stops queue errors", () => {
    expect(manualInvoiceLinkPatch("5093", invoice, "2026-11-09T14:41:00Z")).toEqual({ qb_ref: "2088", invoice_number: "2088", status: "sent", error: null, attach_error: null, sent_at: "2026-11-09T14:41:00Z", attachments_sent: [] });
  });
  it("preserves attachment delivery history when assigning the same invoice", () => {
    expect(manualInvoiceLinkPatch("2088", invoice, "now")).not.toHaveProperty("attachments_sent");
  });
});