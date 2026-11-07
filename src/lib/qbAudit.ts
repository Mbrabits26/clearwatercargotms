/** QuickBooks duplicate audit + payment-document matching. Pure logic, no I/O. */
export type AuditInvoice = {
  id: string; entity: "brokerage" | "fleet"; docNumber: string | null; date: string | null;
  customer: string; total: number; balance: number; text: string; lines: { amount: number; description: string }[];
  /** Load number when the TMS sync is linked to this QB invoice. */
  loadNumber?: string | null; loadId?: string | null;
};
export type DupPair = { kind: "exact" | "same-ref" | "same-doc"; ref: string | null; keep: AuditInvoice; extra: AuditInvoice; overstated: number };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const cents = (n: number) => Math.round(n * 100);

/** Reference-like tokens: 4+ chars that contain a digit (POs, load #s, invoice #s). */
export function refTokens(inv: Pick<AuditInvoice, "text" | "docNumber">): Set<string> {
  const out = new Set<string>();
  for (const t of `${inv.text} ${inv.docNumber ?? ""}`.split(/[\s,;:#/()]+/)) {
    const n = norm(t);
    if (n.length >= 4 && /\d/.test(n) && !/^\d{1,4}(\.\d+)?$/.test(t) && !/^20\d{2}$/.test(n)) out.add(n);
  }
  return out;
}

const linesKey = (i: AuditInvoice) => i.lines.map((l) => `${cents(l.amount)}|${norm(l.description)}`).sort().join("~");

/** Same customer + same amount, plus a shared doc #, a shared reference, or identical date & lines. */
export function findDuplicates(invoices: AuditInvoice[]): DupPair[] {
  const groups = new Map<string, AuditInvoice[]>();
  for (const i of invoices) {
    if (i.total <= 0) continue;
    const k = `${i.entity}|${norm(i.customer)}|${cents(i.total)}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const pairs: DupPair[] = [];
  const used = new Set<string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // TMS-linked first, then oldest, so the one to keep sorts first.
    g.sort((a, b) => Number(!!b.loadNumber) - Number(!!a.loadNumber) || String(a.date).localeCompare(String(b.date)));
    for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) {
      const a = g[x]!, b = g[y]!;
      if (used.has(a.id + a.entity) || used.has(b.id + b.entity)) continue;
      let kind: DupPair["kind"] | null = null, ref: string | null = null;
      if (a.docNumber && b.docNumber && norm(a.docNumber) === norm(b.docNumber)) { kind = "same-doc"; ref = a.docNumber; }
      else if (a.date === b.date && linesKey(a) === linesKey(b)) kind = "exact";
      else {
        const ta = refTokens(a), tb = refTokens(b);
        // Ignore each invoice's own doc number so INV-1 vs INV-2 don't "share" anything.
        if (a.docNumber) { ta.delete(norm(a.docNumber)); tb.delete(norm(a.docNumber)); }
        if (b.docNumber) { ta.delete(norm(b.docNumber)); tb.delete(norm(b.docNumber)); }
        const hit = [...ta].find((t) => tb.has(t));
        // A shared customer ref # (standing PO) on two different TMS loads = two real shipments, not a double.
        const twoLoads = !!a.loadId && !!b.loadId && a.loadId !== b.loadId;
        if (hit && !twoLoads) { kind = "same-ref"; ref = hit.toUpperCase(); }
      }
      if (!kind) continue;
      // Both linked to different TMS loads under one PO = possibly two real shipments; still listed for review.
      used.add(b.id + b.entity);
      pairs.push({ kind, ref, keep: a, extra: b, overstated: Math.min(a.balance, b.balance) });
    }
  }
  return pairs.sort((p, q) => q.overstated - p.overstated);
}

export type PaymentLine = { ref: string | null; amount: number | null };
export type PaymentDoc = { payer: string | null; check_number: string | null; date: string | null; total: number | null; lines: PaymentLine[] };
export type LineMatch = {
  line: PaymentLine; invoice: AuditInvoice | null; confidence: "high" | "probable" | "none";
  status: "matches" | "short" | "over" | "already-paid" | "not-found" | "ambiguous";
};

/** Match each paid line to a QB invoice: ref (doc # or reference in text) first, else unique payer+amount. */
export function matchPayment(doc: PaymentDoc, invoices: AuditInvoice[]): LineMatch[] {
  const payer = norm(doc.payer ?? "");
  const taken = new Set<string>();
  const payerOk = (i: AuditInvoice) => !!payer && (norm(i.customer).includes(payer.slice(0, 8)) || payer.includes(norm(i.customer).slice(0, 8)));
  return doc.lines.map((line) => {
    const r = norm(line.ref ?? "");
    let cands: AuditInvoice[] = [];
    let confidence: LineMatch["confidence"] = "none";
    if (r.length >= 3) {
      cands = invoices.filter((i) => i.docNumber && norm(i.docNumber) === r);
      if (!cands.length && r.length >= 4) cands = invoices.filter((i) => refTokens(i).has(r));
      if (cands.length > 1 && line.amount != null) { const c2 = cands.filter((i) => cents(i.total) === cents(line.amount!)); if (c2.length) cands = c2; }
      if (cands.length > 1 && payer) { const c2 = cands.filter(payerOk); if (c2.length) cands = c2; }
      if (cands.length) confidence = "high";
    }
    if (!cands.length && line.amount != null && payer) {
      cands = invoices.filter((i) => payerOk(i) && i.balance > 0 && cents(i.balance) === cents(line.amount!));
      if (cands.length) confidence = "probable";
    }
    cands = cands.filter((i) => !taken.has(i.entity + i.id));
    if (cands.length > 1 && confidence === "probable") return { line, invoice: null, confidence: "none", status: "ambiguous" };
    const inv = cands[0] ?? null;
    if (!inv) return { line, invoice: null, confidence: "none", status: "not-found" };
    taken.add(inv.entity + inv.id);
    const amt = line.amount ?? inv.balance;
    const status: LineMatch["status"] = inv.balance <= 0 ? "already-paid" : cents(amt) === cents(inv.balance) ? "matches" : cents(amt) < cents(inv.balance) ? "short" : "over";
    return { line, invoice: inv, confidence, status };
  });
}
