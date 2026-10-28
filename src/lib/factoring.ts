import { carrierPayDue, owesCarrier, type PayCarrier } from "@/lib/carrierPay";
import type { Load } from "@/lib/tms";

export type RemitRow = { load: Load; carrier: PayCarrier; gross: number; fee: number; net: number; due: number; daysLeft: number };
export type RemitBatch = {
  key: string;
  factor: string;
  /** Remit-to address on file (from the NOA). */
  remit: string;
  /** Carriers of this factor on file with different remit addresses — check before paying (payment-redirect fraud). */
  remitConflict: boolean;
  /** Carriers in this batch with no Notice of Assignment on file. */
  noaMissing: string[];
  rows: RemitRow[];
  gross: number; fee: number; net: number;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(llc|inc|co|corp|company|the)\b/g, "").replace(/\s+/g, " ").trim();
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Unpaid brokered loads of factored carriers, one batch per factoring company,
 * so a single payment + remittance schedule goes to each factor.
 */
export function factoringBatches(loads: Load[], carriers: Map<string, PayCarrier>, invoiced: Set<string>, now = Date.now()): RemitBatch[] {
  const byKey = new Map<string, RemitBatch & { remits: Set<string> }>();
  for (const l of loads) {
    const c = carriers.get(l.carrier_id ?? "");
    if (!c?.factoring_company?.trim() || !owesCarrier(l, invoiced.has(l.id))) continue;
    const key = norm(c.factoring_company);
    if (!key) continue;
    let b = byKey.get(key);
    if (!b) { b = { key, factor: c.factoring_company.trim(), remit: "", remitConflict: false, noaMissing: [], rows: [], gross: 0, fee: 0, net: 0, remits: new Set() }; byKey.set(key, b); }
    const remit = (c.factoring_remit_address || c.factoring_remit || "").trim();
    if (remit) { b.remits.add(norm(remit)); if (!b.remit) b.remit = remit; }
    if (!c.noa_received && !b.noaMissing.includes(c.legal_name)) b.noaMissing.push(c.legal_name);
    const d = carrierPayDue(l, c, now);
    b.rows.push({ load: l, carrier: c, gross: d.gross, fee: d.fee, net: d.net, due: d.due, daysLeft: d.daysLeft });
    b.gross = r2(b.gross + d.gross); b.fee = r2(b.fee + d.fee); b.net = r2(b.net + d.net);
  }
  return [...byKey.values()]
    .map(({ remits, ...b }) => ({ ...b, remitConflict: remits.size > 1, rows: b.rows.sort((x, y) => x.due - y.due) }))
    .sort((a, b) => a.factor.localeCompare(b.factor));
}
