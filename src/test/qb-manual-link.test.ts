import { describe, expect, it } from "vitest";
import { manualInvoiceLinkPatch, manualInvoiceUnlinkPatch } from "../lib/qbManualLink";
import type { QbInvoice } from "../lib/qbMatch";

const invoice: QbInvoice = { id: "2088", docNumber: "2088", customer: "Madison Wood Preservers", total: 1000, balance: 1000, date: "2026-10-01", text: "", lines: [] };
describe("manual existing invoice assignment", () => {
  it("removes a wrong assignment without deleting the invoice or queuing a duplicate", () => {
    const before = { qb_ref: "5048", invoice_number: "2165", amount: 1625, status: "sent", paid: true };
    const after = { ...before, ...manualInvoiceUnlinkPatch() };
    expect(after).toMatchObject({ qb_ref: null, invoice_number: null, amount: 1625, status: "hold", paid: true, sent_at: null, attachments_sent: [] });
  });
  it("clears CW-10508's stale 2165 number even when its QuickBooks link is already empty", () => {
    const before = { load_number: "CW-10508", customer_ref: "40115924", qb_ref: null, invoice_number: "2165", amount: 1625, status: "hold" };
    expect({ ...before, ...manualInvoiceUnlinkPatch() }).toMatchObject({ load_number: "CW-10508", customer_ref: "40115924", qb_ref: null, invoice_number: null, amount: 1625, status: "hold" });
  });
  it("replaces FF-1017's stale 5093 reference with verified 2088 and stops queue errors", () => {
    expect(manualInvoiceLinkPatch("5093", invoice, "2026-11-09T14:41:00Z")).toEqual({ qb_ref: "2088", invoice_number: "2088", status: "sent", error: null, attach_error: null, sent_at: "2026-11-09T14:41:00Z", attachments_sent: [] });
  });
  it("preserves attachment delivery history when assigning the same invoice", () => {
    expect(manualInvoiceLinkPatch("2088", invoice, "now")).not.toHaveProperty("attachments_sent");
  });
});
import { invoiceNumberVariants } from "@/lib/qbManualLink";
import { it as it2, expect as expect2 } from "vitest";
it2("typed QB numbers try plain and INV-/FF- forms", () => {
  expect2(invoiceNumberVariants(" ff-1018 ")).toEqual(["FF-1018", "1018", "INV-1018"]);
  expect2(invoiceNumberVariants("2165")).toEqual(["2165", "INV-2165", "FF-2165"]);
});
