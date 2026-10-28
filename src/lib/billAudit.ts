/** Carrier bill audit: the carrier's own invoice vs. the signed rate con (and the load as it stands now). */
export type ChargeLine = { description: string; amount: number };
export type AuditStatus = "match" | "over" | "under" | "no_invoice";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Charge categories so "Detention 2 hrs" on a carrier invoice lines up with "Detention" on the rate con. */
const CATS: [string, RegExp][] = [
  ["tracking", /^tracking/i],
  ["detention", /detention|wait(ing)?\s*time/i],
  ["lumper", /lumper|unload(ing)?\s*fee/i],
  ["layover", /layover/i],
  ["tonu", /\btonu\b|truck\s*ordered\s*not\s*used/i],
  ["fuel", /fuel|\bfsc\b/i],
  ["stop", /stop[\s-]*off|extra\s*stop|stop\s*charge|additional\s*stop/i],
  ["driver assist", /driver\s*assist|hand\s*unload/i],
  ["tarp", /tarp/i],
  ["scale", /scale/i],
  ["redelivery", /re-?delivery|re-?consign/i],
  ["after hours", /after[\s-]*hours|weekend|holiday/i],
  ["linehaul", /line\s*-?haul|freight|flat\s*rate|\brate\b|transport|haul|trucking/i],
];
export function chargeCategory(description: string): string {
  return CATS.find(([, re]) => re.test(description))?.[0] ?? "other";
}

export type BillAudit = {
  status: AuditStatus;
  /** What we agreed to pay: the signed rate con total, else the load's carrier pay. */
  expected: number;
  billed: number | null;
  /** billed − expected (positive = carrier billed more). */
  diff: number;
  hasSignedRc: boolean;
  /** Load's carrier pay changed after the rate con was signed. */
  rcChanged: boolean;
  /** Charges on the carrier invoice that the rate con doesn't have. */
  unexpected: ChargeLine[];
  /** Billed exactly $200 short on a tracking rate con — the tracking fee was likely forfeited. */
  trackingForfeit: boolean;
};

export function auditBill(o: { rcTotal: number | null; rcLines?: { label: string; amount: number }[]; loadCost: number; billed: number | null; billedLines?: ChargeLine[] }): BillAudit {
  const hasSignedRc = o.rcTotal != null;
  const expected = round2(o.rcTotal ?? o.loadCost);
  const rcChanged = hasSignedRc && Math.abs(round2(o.rcTotal! - o.loadCost)) >= 0.01;
  const rcCats = new Set((o.rcLines ?? []).filter((l) => Number(l.amount)).map((l) => chargeCategory(l.label)));
  const unexpected = (o.billedLines ?? []).filter((l) => {
    if (!(Number(l.amount) > 0)) return false;
    const c = chargeCategory(l.description);
    return c !== "linehaul" && c !== "tracking" && !rcCats.has(c);
  });
  if (o.billed == null) return { status: "no_invoice", expected, billed: null, diff: 0, hasSignedRc, rcChanged, unexpected, trackingForfeit: false };
  const diff = round2(o.billed - expected);
  const status: AuditStatus = Math.abs(diff) < 0.01 ? "match" : diff > 0 ? "over" : "under";
  const trackingForfeit = status === "under" && Math.abs(diff + 200) < 0.01 && rcCats.has("tracking");
  return { status, expected, billed: round2(o.billed), diff, hasSignedRc, rcChanged, unexpected, trackingForfeit };
}

/** Plain-English problems for one bill (empty = clean). */
export function auditFlags(a: BillAudit): string[] {
  const out: string[] = [];
  if (a.status === "no_invoice") out.push("No carrier invoice yet");
  if (a.status === "over") out.push(`Billed $${a.diff.toFixed(2)} over the rate con`);
  if (a.status === "under") out.push(a.trackingForfeit ? "Billed $200 under — tracking fee forfeited?" : `Billed $${Math.abs(a.diff).toFixed(2)} under the rate con`);
  if (a.unexpected.length) out.push(`Charges not on the rate con: ${a.unexpected.map((l) => l.description).join(", ")}`);
  if (a.rcChanged) out.push("Carrier pay changed after the rate con was signed");
  if (!a.hasSignedRc) out.push("No signed rate con — compared to load carrier pay");
  return out;
}

export function parseChargeLines(v: unknown): ChargeLine[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => (x && typeof x === "object" && typeof (x as ChargeLine).description === "string" && Number.isFinite(Number((x as ChargeLine).amount))
    ? [{ description: (x as ChargeLine).description, amount: Number((x as ChargeLine).amount) }] : []));
}
