import type { QbInvoice } from "./qbMatch";

/** Hold an unlinked invoice so a sync cannot accidentally create a replacement. */
export function manualInvoiceUnlinkPatch() {
  return { qb_ref: null, invoice_number: null, status: "hold", sent_at: null, error: null, attach_error: null, attachments_sent: [] as string[] };
}

/** A manual correction acknowledges an existing invoice; it never queues a new one or marks a load paid. */
export function manualInvoiceLinkPatch(previousRef: string | null, invoice: QbInvoice, now: string) {
  return {
    qb_ref: invoice.id,
    invoice_number: invoice.docNumber,
    status: "sent",
    error: null,
    attach_error: null,
    sent_at: now,
    ...(previousRef !== invoice.id ? { attachments_sent: [] as string[] } : {}),
  };
}
/** Typed QuickBooks invoice numbers: exact, digits only, and INV-/FF- forms (e.g. "1018" → 1018, INV-1018, FF-1018). */
export function invoiceNumberVariants(value: string): string[] {
  const v = value.trim().toUpperCase().replace(/\s+/g, "");
  const digits = v.replace(/^(INV|FF|CW)-?/, "");
  return [...new Set([v, digits, `INV-${digits}`, `FF-${digits}`].filter(Boolean))];
}
