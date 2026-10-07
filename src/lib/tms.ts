import type { Tables, Enums } from "@/integrations/supabase/types";

export type Load = Tables<"loads">;
export type Carrier = Tables<"carriers">;
export type Company = Tables<"companies">;
export type Profile = Tables<"profiles">;
export type LoadStatus = Enums<"load_status">;
export type Accessorial = { type: string; amount: number };

export const STATUSES: { value: LoadStatus; label: string; cls: string }[] = [
  { value: "available", label: "Available", cls: "bg-st-available/15 text-st-available border-st-available/40" },
  { value: "vetting", label: "Vetting", cls: "bg-st-vetting/15 text-st-vetting border-st-vetting/40" },
  { value: "booked", label: "Booked", cls: "bg-st-booked/15 text-st-booked border-st-booked/40" },
  { value: "dispatched", label: "Dispatched", cls: "bg-st-dispatched/15 text-st-dispatched border-st-dispatched/40" },
  { value: "rolling", label: "Loaded / Rolling", cls: "bg-st-rolling/15 text-st-rolling border-st-rolling/40" },
  { value: "delivered", label: "Delivered", cls: "bg-st-delivered/15 text-st-delivered border-st-delivered/40" },
  { value: "invoiced", label: "Invoiced", cls: "bg-st-invoiced/15 text-st-invoiced border-st-invoiced/40" },
  { value: "paid", label: "Completed / Paid", cls: "bg-st-paid/15 text-st-paid border-st-paid/40" },
  { value: "issue", label: "Delay / Issue", cls: "bg-st-issue/15 text-st-issue border-st-issue/40" },
  { value: "cancelled", label: "Cancelled", cls: "bg-muted text-muted-foreground border-muted-foreground/40" },
];
export const statusMeta = (s: LoadStatus) => STATUSES.find((x) => x.value === s)!;

export const EQUIPMENT = ["Dry Van", "Reefer", "Flatbed", "Step Deck", "Power Only", "Conestoga", "Hotshot", "Box Truck"];
export const ACCESSORIAL_TYPES = ["Detention", "Layover", "TONU", "Lumper", "Driver Assist", "Fuel Surcharge"];
export const DNU_REASONS = ["Double-brokering", "Hostage load", "Late cancel", "Fraud / identity theft", "Cargo claim", "Safety concern"];

export const usd = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export function accessorialTotal(l: Pick<Load, "accessorials">) {
  const a = (l.accessorials as Accessorial[] | null) ?? [];
  return a.reduce((s, x) => s + Number(x.amount || 0), 0);
}
export function loadTotals(l: Load) {
  const acc = accessorialTotal(l);
  const revenue = Number(l.customer_rate) + acc;
  const cost = Number(l.carrier_rate) + acc;
  const margin = revenue - cost;
  return { acc, revenue, cost, margin, pct: revenue ? (margin / revenue) * 100 : 0 };
}

export function carrierCompliance(c: Carrier) {
  const issues: string[] = [];
  if (c.status === "dnu") issues.push(`Do Not Use: ${c.dnu_reason ?? "no reason"}`);
  if (c.authority_status !== "Authorized") issues.push(`Authority ${c.authority_status}`);
  if (!c.insurance_expires || new Date(c.insurance_expires) < new Date()) issues.push("Auto liability insurance missing/expired");
  if (c.cargo_expires && new Date(c.cargo_expires) < new Date()) issues.push("Cargo insurance expired");
  if (c.factoring_company && !c.noa_received) issues.push("Factoring NOA missing");
  if (!c.w9_received) issues.push("W-9 missing");
  if (!c.coi_received) issues.push("COI missing");
  if (!c.agreement_signed) issues.push("Broker agreement unsigned");
  const conditional = c.status === "pending" && !!c.conditional_until && c.conditional_until >= new Date().toISOString().slice(0, 10)
    && c.authority_status === "Authorized";
  // Mirrors the enforce_carrier_compliance DB trigger: what actually blocks booking.
  const hardBlock = c.status === "dnu" || c.authority_status !== "Authorized";
  const insured = !!c.insurance_expires && new Date(c.insurance_expires) >= new Date(new Date().toDateString());
  const bookable = !hardBlock && (conditional || (c.status === "vetted" && insured));
  const blockReason = c.status === "dnu" ? `Do Not Use: ${c.dnu_reason ?? "no reason"}` : c.authority_status !== "Authorized" ? `Authority ${c.authority_status}`
    : c.status !== "vetted" && !conditional ? "Not vetted yet" : !insured && !conditional ? "Auto liability insurance missing/expired" : null;
  if (conditional) return { ok: true, conditional: true, issues, hardBlock, bookable, blockReason };
  return { ok: issues.length === 0 && c.status === "vetted", conditional: false, issues, hardBlock, bookable, blockReason };
}

export const CHECK_CALL_HOURS = 4;
export function checkCallOverdue(l: Load) {
  if (!["dispatched", "rolling", "issue"].includes(l.status)) return false;
  const last = l.last_check_call ? new Date(l.last_check_call).getTime() : 0;
  return Date.now() - last > CHECK_CALL_HOURS * 3600_000;
}
export type FleetUnit = Tables<"fleet_units">;
export type Driver = Tables<"drivers">;
export const UNIT_STATUSES = [
  { value: "available", label: "Available", cls: "border-success/50 text-success" },
  { value: "assigned", label: "Assigned", cls: "border-gold/50 text-gold" },
  { value: "maintenance", label: "Maintenance", cls: "border-warning/50 text-warning" },
  { value: "out_of_service", label: "Out of service", cls: "border-destructive/50 text-destructive" },
];
export const DRIVER_STATUSES = [
  { value: "available", label: "Available", cls: "border-success/50 text-success" },
  { value: "on_load", label: "On load", cls: "border-gold/50 text-gold" },
  { value: "off_duty", label: "Off duty", cls: "border-muted-foreground/50 text-muted-foreground" },
  { value: "unavailable", label: "Unavailable", cls: "border-destructive/50 text-destructive" },
];
export const ACTIVE_STATUSES = ["booked", "dispatched", "rolling", "issue", "vetting"];

export const EXPIRY_SOON_DAYS = 30;
export type ExpiryState = "missing" | "expired" | "soon" | "ok";
export function expiryState(d: string | null | undefined): ExpiryState {
  if (!d) return "missing";
  const days = (new Date(d).getTime() - Date.now()) / 86400_000;
  if (days < 0) return "expired";
  if (days <= EXPIRY_SOON_DAYS) return "soon";
  return "ok";
}
export function carrierExpiry(c: Carrier): ExpiryState {
  const s = [expiryState(c.insurance_expires), c.cargo_expires ? expiryState(c.cargo_expires) : "ok"];
  return s.includes("expired") || s.includes("missing") ? (s.includes("expired") ? "expired" : "missing") : s.includes("soon") ? "soon" : "ok";
}
export const DOC_KINDS = [
  { value: "w9", label: "W-9" },
  { value: "coi", label: "Certificate of insurance" },
  { value: "agreement", label: "Broker-carrier agreement" },
  { value: "noa", label: "Factoring NOA" },
  { value: "voided_check", label: "Voided check" },
] as const;

export const PERMISSIONS = [
  { key: "dispatch", label: "Dispatch Board" },
  { key: "directory", label: "Directory" },
  { key: "carriers", label: "Carriers" },
  { key: "fleet", label: "Fleet" },
  { key: "leads", label: "Sales leads" },
  { key: "quotes", label: "Quotes & RFPs" },
  { key: "reports", label: "Reports" },
  { key: "export", label: "CSV / load board export" },
] as const;
export const DEFAULT_PERMS = PERMISSIONS.map((p) => p.key) as string[];

/** Carrier pay options: carrier picks one at onboarding; staff can change it per carrier or per load. */
export type PayTerms = "net30" | "quickpay" | "factored_quickpay";
export const PAY_TERMS: { value: PayTerms; label: string; fee: number; terms: string }[] = [
  { value: "net30", label: "Net 30 (no fee)", fee: 0, terms: "Net 30" },
  { value: "quickpay", label: "Quick Pay – 5% fee, paid in 3 days", fee: 0.05, terms: "Quick Pay: 5% fee, paid in 3 days" },
  { value: "factored_quickpay", label: "Factored Quick Pay – 2.5% fee", fee: 0.025, terms: "Factored Quick Pay: 2.5% fee" },
];
export const payTermsOf = (v: string | null | undefined) => PAY_TERMS.find((p) => p.value === v) ?? PAY_TERMS[0]!;
/** Load override wins, else the carrier's chosen option. */
export const effectivePayTerms = (load: { pay_terms?: string | null }, carrier?: { pay_terms?: string | null } | null) =>
  payTermsOf(load.pay_terms ?? carrier?.pay_terms);
