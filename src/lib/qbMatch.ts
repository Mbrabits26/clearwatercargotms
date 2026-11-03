/** Scores QuickBooks invoices against TMS loads when invoice numbers don't line up. */
export type QbInvoice = {
  id: string; docNumber: string | null; date: string | null; customer: string; total: number; balance: number;
  lines: { amount: number; description: string }[]; text: string;
};
export type MatchLoad = {
  id: string; load_number: string; customer: string; customer_rate: number; net?: number;
  origin_city: string; origin_state: string; dest_city: string; dest_state: string; delivery_at: string | null; pickup_at: string | null;
  customer_ref?: string | null; ship_ref?: string | null;
  /** The TMS invoice number on this load (INV-…/FF-… or a linked QuickBooks number), if any. */
  invoice_number?: string | null;
};
/**
 * high = a reference number ties them together (load #, invoice #, customer ref #, shipper PO #) plus customer or amount.
 * probable = customer + amount (no reference) — needs a person to confirm. weak = everything else.
 * tie = another load scores the same for this invoice, so it can't be picked automatically.
 */
export type Match = { load: MatchLoad; score: number; level: "high" | "probable" | "weak"; reasons: string[]; tie?: boolean };

export const normName = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(llc|inc|incorporated|co|corp|corporation|company|ltd|the|lp|llp)\b/g, " ").replace(/\s+/g, " ").trim();

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Reference numbers compared as whole tokens, ignoring case, spaces and dashes; refs shorter than 3 chars are ignored. */
const refKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function textHasRef(text: string, ref: string | null | undefined): boolean {
  const want = refKey(ref ?? "");
  if (want.length < 3) return false;
  const tokens = text.toLowerCase().split(/[\s,;:#/()|]+/).map(refKey).filter(Boolean);
  return tokens.includes(want) || refKey(text).length === want.length && refKey(text) === want;
}

/** Same customer? exact = normalized names equal; partial = one contains the other; different = no shared word. */
export function customerFit(a: string, b: string): "exact" | "partial" | "different" | "unknown" {
  const x = normName(a), y = normName(b);
  if (!x || !y) return "unknown";
  if (x === y) return "exact";
  if ((x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y))) return "partial";
  const wx = new Set(x.split(" ").filter((w) => w.length >= 3));
  return y.split(" ").some((w) => wx.has(w)) ? "partial" : "different";
}

export function scoreMatch(inv: QbInvoice, l: MatchLoad): Match {
  let score = 0; let ids = 0; const reasons: string[] = [];
  const fit = customerFit(inv.customer, l.customer);
  if (fit === "exact") { score += 30; reasons.push("Customer"); }
  else if (fit === "partial") { score += 20; reasons.push("Customer (similar name)"); }
  else if (fit === "different") { score -= 30; reasons.push("Different customer"); }
  const amts = [l.customer_rate, l.net ?? l.customer_rate].filter((x) => x > 0);
  let amount = false;
  if (amts.some((x) => near(x, inv.total))) { score += 30; amount = true; reasons.push("Total amount"); }
  else if (amts.some((x) => inv.lines.some((ln) => near(ln.amount, x)))) { score += 20; amount = true; reasons.push("Line amount"); }
  const hay = `${inv.text} ${inv.docNumber ?? ""}`;
  if (textHasRef(hay, l.load_number)) { score += 50; ids++; reasons.push("Load #"); }
  if (l.invoice_number && inv.docNumber && refKey(l.invoice_number) === refKey(inv.docNumber)) { score += 50; ids++; reasons.push("Invoice #"); }
  if (textHasRef(inv.text, l.customer_ref)) { score += 40; ids++; reasons.push("Customer ref #"); }
  if (refKey(l.ship_ref ?? "") !== refKey(l.customer_ref ?? "") && textHasRef(inv.text, l.ship_ref)) { score += 40; ids++; reasons.push("Shipper PO #"); }
  const t = inv.text.toLowerCase();
  if (l.origin_city && t.includes(l.origin_city.toLowerCase())) { score += 5; reasons.push("Pickup city"); }
  if (l.dest_city && t.includes(l.dest_city.toLowerCase())) { score += 5; reasons.push("Delivery city"); }
  const ref = l.delivery_at ?? l.pickup_at;
  if (inv.date && ref) {
    const days = (new Date(inv.date).getTime() - new Date(ref).getTime()) / 86400_000;
    if (days >= -3 && days <= 21) { score += 10; reasons.push("Date"); }
    else if (Math.abs(days) > 60) { score -= 15; reasons.push("Dates far apart"); }
  }
  const backed = ids > 0 && (fit === "exact" || fit === "partial" || amount);
  const level = backed && score >= 70 ? "high" : score >= 60 && fit !== "different" ? "probable" : "weak";
  return { load: l, score, level, reasons };
}

export function bestMatches(inv: QbInvoice, loads: MatchLoad[], n = 3): Match[] {
  const all = loads.map((l) => scoreMatch(inv, l)).filter((m) => m.score >= 40).sort((x, y) => y.score - x.score);
  // Two loads that score the same (e.g. same customer and same rate, no ref #) can't be told apart automatically.
  if (all[0] && all[1] && all[0].score === all[1].score) all[0] = { ...all[0], tie: true, level: all[0].level === "high" && all[1].level === "high" ? "probable" : all[0].level };
  return all.slice(0, n);
}

export type InvoicePlan = {
  matches: Match[];
  /** Suggested load after one-to-one pairing (never the same load for two invoices). */
  best: Match | null;
  /** Another QuickBooks invoice also points strongly at this load — possible double in QuickBooks. */
  doubleOf: QbInvoice | null;
};

/**
 * Pairs QuickBooks invoices with loads one-to-one, strongest first. When two invoices both
 * strongly (high) match the same load, the weaker one is flagged as a possible double.
 */
export function planMatches(invoices: QbInvoice[], loads: MatchLoad[]): Map<string, InvoicePlan> {
  const per = new Map(invoices.map((i) => [i.id, bestMatches(i, loads, 3)] as const));
  const pairs = invoices.flatMap((i) => (per.get(i.id) ?? []).map((m) => ({ inv: i, m }))).sort((a, b) => b.m.score - a.m.score);
  const usedLoad = new Map<string, QbInvoice>(), chosen = new Map<string, Match>(), doubles = new Map<string, QbInvoice>();
  for (const { inv, m } of pairs) {
    if (chosen.has(inv.id) || doubles.has(inv.id)) continue;
    const owner = usedLoad.get(m.load.id);
    if (owner) {
      if (m.level === "high" && !doubles.has(inv.id)) doubles.set(inv.id, owner);
      continue;
    }
    if (m.level === "weak" && !m.reasons.some((r) => r === "Customer" || r === "Total amount")) continue;
    usedLoad.set(m.load.id, inv); chosen.set(inv.id, m);
  }
  return new Map(invoices.map((i) => [i.id, { matches: per.get(i.id) ?? [], best: chosen.get(i.id) ?? null, doubleOf: doubles.get(i.id) ?? null }]));
}
