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
  if (!c.insurance_expires || new Date(c.insurance_expires) < new Date()) issues.push("Insurance missing/expired");
  if (!c.w9_received) issues.push("W-9 missing");
  if (!c.coi_received) issues.push("COI missing");
  if (!c.agreement_signed) issues.push("Broker agreement unsigned");
  return { ok: issues.length === 0 && c.status === "vetted", issues };
}

export const CHECK_CALL_HOURS = 4;
export function checkCallOverdue(l: Load) {
  if (!["dispatched", "rolling", "issue"].includes(l.status)) return false;
  const last = l.last_check_call ? new Date(l.last_check_call).getTime() : 0;
  return Date.now() - last > CHECK_CALL_HOURS * 3600_000;
}
