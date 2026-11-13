import type { QbInvoice } from "./qbMatch";

export type CorrectionRow = { id: string; kind: string; invoice_number: string | null; qb_ref: string | null; attachments?: unknown };
export type CorrectionChoice = "blank" | "new" | "previous" | "existing";
export function correctionPlan(rows: CorrectionRow[], group: string, invoice: QbInvoice | null, choice: CorrectionChoice, kind: string, attachmentsSent: string[] = []) {
  if (!rows.length) throw new Error("Invoice group is empty.");
  if ((choice === "previous" || choice === "existing") && !invoice?.docNumber) throw new Error("Verify the existing invoice first.");
  if (invoice && rows.some((r) => r.kind !== kind)) throw new Error("Existing invoices cannot change QuickBooks company.");
  return rows.map((r) => ({ id: r.id, previousRef: r.qb_ref, previousNumber: r.invoice_number, previousKind: r.kind, group, kind,
    qbRef: invoice?.id ?? null, number: invoice?.docNumber ?? null, status: invoice ? "sent" : "hold", allocate: choice === "new", attachmentsSent }));
}