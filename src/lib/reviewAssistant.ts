/** Pure helpers for the finance review assistant: turns an AI-read plan into a reviewable list. Nothing here changes data. */
import { bestMatches, normName, type MatchLoad, type QbInvoice, type Match } from "@/lib/qbMatch";

export type ReviewMode = "qb_match" | "paid_mismatch" | "closeout";
export type ReviewPlan = {
  mode: ReviewMode; customer: string | null; from: string | null; to: string | null;
  minDaysSinceDelivery: number | null; entity: "brokerage" | "fleet"; summary: string;
};
export type CloseoutLoad = { id: string; load_number: string; customer: string; status: string; closed_at: string | null; delivery_at: string | null; pickup_at: string | null; customer_rate: number };
export type MatchRow = { invoice: QbInvoice; match: Match | null };

const customerOk = (want: string | null, name: string) => {
  if (!want) return true;
  const a = normName(want), b = normName(name);
  return !!a && !!b && (a.includes(b) || b.includes(a));
};

/** Pairs each QuickBooks invoice with its best TMS load; paid_mismatch keeps only invoices paid in full in QuickBooks. */
export function matchRows(plan: ReviewPlan, invoices: QbInvoice[], loads: MatchLoad[]): MatchRow[] {
  const inv = invoices.filter((i) => customerOk(plan.customer, i.customer) && (plan.mode !== "paid_mismatch" || i.balance <= 0));
  const pool = loads.filter((l) => customerOk(plan.customer, l.customer));
  return inv.map((i) => ({ invoice: i, match: bestMatches(i, pool, 1)[0] ?? null }))
    .sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1));
}

/** Paid, not yet closed loads delivered at least N days ago (default 0) inside the date range. */
export function closeoutRows(plan: ReviewPlan, loads: CloseoutLoad[], now = Date.now()): CloseoutLoad[] {
  const min = (plan.minDaysSinceDelivery ?? 0) * 86400_000;
  return loads.filter((l) => {
    if (l.closed_at || l.status !== "paid" || !customerOk(plan.customer, l.customer)) return false;
    const ref = l.delivery_at ?? l.pickup_at;
    if (!ref) return min === 0;
    const t = new Date(ref).getTime(), d = ref.slice(0, 10);
    if (now - t < min) return false;
    if (plan.from && d < plan.from) return false;
    if (plan.to && d > plan.to) return false;
    return true;
  });
}
