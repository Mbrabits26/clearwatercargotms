/** Where an invoiced load stands with QuickBooks, for the finance review list. */
export type QbReviewState = "not_queued" | "queued" | "error";

type SyncLike = { load_id: string; kind: string; status: string; qb_ref?: string | null };

/**
 * An invoiced load needs finance review until its customer invoice has reached QuickBooks.
 * Returns null when nothing is left to do (not invoiced, or already sent/linked).
 */
export function qbReviewState(load: { id: string; status: string }, sync: SyncLike[]): QbReviewState | null {
  if (load.status !== "invoiced") return null;
  const rows = sync.filter((s) => s.load_id === load.id && s.kind !== "bill");
  if (!rows.length) return "not_queued";
  if (rows.some((s) => s.status === "sent" || !!s.qb_ref)) return null;
  if (rows.some((s) => s.status === "error")) return "error";
  return "queued";
}

/** True when a load-notes status entry records a move into Invoiced. */
export const isInvoicedNote = (body: unknown) => typeof body === "string" && /^Status changed: (?!invoiced\b)\S+ → invoiced$/.test(body.trim());

export const QB_REVIEW_LABEL: Record<QbReviewState, string> = {
  not_queued: "Not queued",
  queued: "Queued — not sent",
  error: "Send failed",
};
