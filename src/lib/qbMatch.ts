/** Scores QuickBooks invoices against TMS loads when invoice numbers don't line up. */
export type QbInvoice = {
  id: string; docNumber: string | null; date: string | null; customer: string; total: number; balance: number;
  lines: { amount: number; description: string }[]; text: string;
};
export type MatchLoad = {
  id: string; load_number: string; customer: string; customer_rate: number; net?: number;
  origin_city: string; origin_state: string; dest_city: string; dest_state: string; delivery_at: string | null; pickup_at: string | null;
};
export type Match = { load: MatchLoad; score: number; level: "high" | "probable" | "weak"; reasons: string[] };

export const normName = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(llc|inc|incorporated|co|corp|corporation|company|ltd|the|lp|llp)\b/g, " ").replace(/\s+/g, " ").trim();

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

export function scoreMatch(inv: QbInvoice, l: MatchLoad): Match {
  let score = 0; const reasons: string[] = [];
  const a = normName(inv.customer), b = normName(l.customer);
  if (a && b && (a === b || a.includes(b) || b.includes(a))) { score += 40; reasons.push("Customer"); }
  const amts = [l.customer_rate, l.net ?? l.customer_rate].filter((x) => x > 0);
  if (amts.some((x) => near(x, inv.total))) { score += 35; reasons.push("Total amount"); }
  else if (amts.some((x) => inv.lines.some((ln) => near(ln.amount, x)))) { score += 25; reasons.push("Line amount"); }
  const t = inv.text.toLowerCase();
  if (l.origin_city && t.includes(l.origin_city.toLowerCase())) { score += 10; reasons.push("Pickup city"); }
  if (l.dest_city && t.includes(l.dest_city.toLowerCase())) { score += 10; reasons.push("Delivery city"); }
  if (l.load_number && t.includes(l.load_number.toLowerCase())) { score += 30; reasons.push("Load #"); }
  const ref = l.delivery_at ?? l.pickup_at;
  if (inv.date && ref) {
    const days = (new Date(inv.date).getTime() - new Date(ref).getTime()) / 86400_000;
    if (days >= -3 && days <= 21) { score += 10; reasons.push("Date"); }
  }
  const level = score >= 85 ? "high" : score >= 70 ? "probable" : "weak";
  return { load: l, score, level, reasons };
}

export function bestMatches(inv: QbInvoice, loads: MatchLoad[], n = 3): Match[] {
  return loads.map((l) => scoreMatch(inv, l)).filter((m) => m.score >= 40).sort((x, y) => y.score - x.score).slice(0, n);
}
