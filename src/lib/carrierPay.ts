import { effectivePayTerms, isFleetLoad, loadTotals, type Carrier, type Load, type PayTerms } from "@/lib/tms";

const DAY = 86_400_000;
/** Days from POD to pay: Quick Pay options pay in 3 days, everything else Net 30. */
export const payDays = (t: PayTerms) => (t === "quickpay" || t === "factored_quickpay" ? 3 : 30);
export const isQuickPay = (t: PayTerms) => t === "quickpay" || t === "factored_quickpay";

export type PayCarrier = Pick<Carrier, "id" | "legal_name" | "pay_terms" | "factoring_company" | "factoring_remit" | "factoring_remit_address" | "noa_received" | "address" | "city" | "state" | "zip">;

/**
 * Brokered load with a carrier that hasn't been marked paid, once the POD is in OR the customer
 * has been invoiced (status Invoiced or an invoice exists) — so cleaned-up older loads still show.
 */
export const owesCarrier = (l: Load, hasInvoice = false) =>
  !!l.carrier_id && !l.carrier_paid_at && !isFleetLoad(l) && ["delivered", "invoiced", "paid"].includes(l.status)
  && (l.pod_received || hasInvoice || l.status === "invoiced");

/** Pay math + due date for one load. Clock starts when the POD came in. */
export function carrierPayDue(l: Load, carrier: PayCarrier | null | undefined, now = Date.now()) {
  const pt = effectivePayTerms(l, carrier);
  const gross = loadTotals(l).cost;
  const fee = Math.round(gross * pt.fee * 100) / 100;
  // Clock starts at the POD; without one (older loads) it starts at delivery.
  const start = new Date((l.pod_received ? l.pod_received_at : null) ?? l.delivery_at ?? l.pod_received_at ?? l.created_at).getTime();
  const due = start + payDays(pt.value) * DAY;
  return { fromPod: !!l.pod_received && !!l.pod_received_at, pt, gross, fee, net: Math.round((gross - fee) * 100) / 100, podAt: start, due, daysLeft: Math.ceil((due - now) / DAY), quickPay: isQuickPay(pt.value) };
}

/** Quick Pay shows the moment the POD is in; Net 30 shows once it is within `leadDays` of due (or past due). */
export const shouldNotify = (d: ReturnType<typeof carrierPayDue>, leadDays: number) => d.quickPay || d.daysLeft <= leadDays;

/** Who the check/ACH goes to: the factoring company when the carrier is factored, else the carrier. */
export function payTo(c: PayCarrier | null | undefined) {
  if (!c) return { name: "Unknown carrier", address: "", factored: false, noaMissing: false };
  if (c.factoring_company) {
    return { name: c.factoring_company, address: c.factoring_remit_address || c.factoring_remit || "", factored: true, noaMissing: !c.noa_received, forCarrier: c.legal_name };
  }
  const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const hasCity = !!c.city && !!c.address?.toLowerCase().includes(c.city.toLowerCase());
  return { name: c.legal_name, address: [c.address, hasCity ? "" : cityLine].filter(Boolean).join(", "), factored: false, noaMissing: false };
}

export const maskAccount = (n: string | null | undefined) => (n ? `••••${n.replace(/\s/g, "").slice(-4)}` : "—");

/** Where one of a carrier's loads stands on our side of the money. */
export type CarrierPayState = "paid" | "owed" | "waiting_pod" | "not_delivered";
export const PAY_STATE_LABEL: Record<CarrierPayState, string> = {
  paid: "Paid", owed: "Owed — ready to pay", waiting_pod: "Delivered — waiting on POD", not_delivered: "Not delivered yet",
};
export function carrierPayState(l: Load, hasInvoice = false): CarrierPayState {
  if (l.carrier_paid_at) return "paid";
  if (owesCarrier(l, hasInvoice)) return "owed";
  if (["delivered", "invoiced", "paid"].includes(l.status)) return "waiting_pod";
  return "not_delivered";
}

/** Totals per pay state for one carrier's brokered loads (company-truck and cancelled loads left out). */
export function carrierPaySummary(loads: Load[], carrier: PayCarrier | null | undefined, invoiced: Set<string>, now = Date.now()) {
  const out = Object.fromEntries((["paid", "owed", "waiting_pod", "not_delivered"] as const).map((k) => [k, { count: 0, net: 0 }])) as Record<CarrierPayState, { count: number; net: number }>;
  let pastDue = 0;
  for (const l of loads) {
    if (l.status === "cancelled" || isFleetLoad(l)) continue;
    const s = carrierPayState(l, invoiced.has(l.id));
    const d = carrierPayDue(l, carrier, now);
    out[s].count += 1;
    out[s].net = Math.round((out[s].net + d.net) * 100) / 100;
    if (s === "owed" && d.daysLeft < 0) pastDue += 1;
  }
  return { ...out, pastDue };
}
