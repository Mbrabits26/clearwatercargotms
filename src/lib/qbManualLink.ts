import type { QbInvoice } from "./qbMatch";

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