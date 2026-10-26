/** Where a load stands on the customer-billing side, for Reports filters and columns. */
export type BillingStage = "not_delivered" | "needs_invoice" | "invoiced" | "sent" | "paid" | "cancelled";

export const BILLING_STAGES: { value: BillingStage; label: string }[] = [
  { value: "not_delivered", label: "Not delivered yet" },
  { value: "needs_invoice", label: "Needs invoicing" },
  { value: "invoiced", label: "Invoiced — not in QuickBooks" },
  { value: "sent", label: "In QuickBooks — awaiting payment" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];
export const ALL_STAGES = BILLING_STAGES.map((s) => s.value);
export const stageLabel = (s: BillingStage) => BILLING_STAGES.find((x) => x.value === s)!.label;

type SyncLike = { load_id: string | null; kind: string; status: string; qb_ref?: string | null; invoice_number?: string | null };
type LoadLike = { id: string; status: string };

const customerRows = (loadId: string, sync: SyncLike[]) => sync.filter((s) => s.load_id === loadId && s.kind !== "bill");
const isSent = (s: SyncLike) => s.status === "sent" || !!s.qb_ref;

/** Customer-invoice stage: paid status wins, then a sent/linked QuickBooks invoice, then the load status. */
export function billingStage(load: LoadLike, sync: SyncLike[]): BillingStage {
  if (load.status === "paid") return "paid";
  if (load.status === "cancelled") return "cancelled";
  if (customerRows(load.id, sync).some(isSent)) return "sent";
  if (load.status === "invoiced") return "invoiced";
  if (load.status === "delivered") return "needs_invoice";
  return "not_delivered";
}

/** Customer invoice number for a load (sent ones first), or "" when none exists yet. */
export function invoiceNumberOf(loadId: string, sync: SyncLike[]): string {
  const rows = customerRows(loadId, sync);
  const best = rows.find((r) => isSent(r) && r.invoice_number) ?? rows.find((r) => r.invoice_number);
  return best?.invoice_number ?? "";
}

/** Index qb_sync rows by load once so large reports don't rescan the whole list per row. */
export function syncByLoad<T extends SyncLike>(sync: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const s of sync) if (s.load_id) m.set(s.load_id, [...(m.get(s.load_id) ?? []), s]);
  return m;
}
