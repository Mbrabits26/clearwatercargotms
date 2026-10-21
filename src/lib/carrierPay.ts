import { effectivePayTerms, isFleetLoad, loadTotals, type Carrier, type Load, type PayTerms } from "@/lib/tms";

const DAY = 86_400_000;
/** Days from POD to pay: Quick Pay options pay in 3 days, everything else Net 30. */
export const payDays = (t: PayTerms) => (t === "quickpay" || t === "factored_quickpay" ? 3 : 30);
export const isQuickPay = (t: PayTerms) => t === "quickpay" || t === "factored_quickpay";

export type PayCarrier = Pick<Carrier, "id" | "legal_name" | "pay_terms" | "factoring_company" | "factoring_remit" | "factoring_remit_address" | "noa_received" | "address" | "city" | "state" | "zip">;

/** Brokered load with a carrier, POD in, and the carrier not yet marked paid. */
export const owesCarrier = (l: Load) =>
  !!l.carrier_id && l.pod_received && !l.carrier_paid_at && !isFleetLoad(l) && ["delivered", "invoiced", "paid"].includes(l.status);

/** Pay math + due date for one load. Clock starts when the POD came in. */
export function carrierPayDue(l: Load, carrier: PayCarrier | null | undefined, now = Date.now()) {
  const pt = effectivePayTerms(l, carrier);
  const gross = loadTotals(l).cost;
  const fee = Math.round(gross * pt.fee * 100) / 100;
  const start = new Date(l.pod_received_at ?? l.delivery_at ?? l.created_at).getTime();
  const due = start + payDays(pt.value) * DAY;
  return { pt, gross, fee, net: Math.round((gross - fee) * 100) / 100, podAt: start, due, daysLeft: Math.ceil((due - now) / DAY), quickPay: isQuickPay(pt.value) };
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
