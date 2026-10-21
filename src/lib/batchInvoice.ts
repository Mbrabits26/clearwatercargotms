import { supabase } from "@/integrations/supabase/client";
import { isFleetLoad, loadTotals, type Company, type Load } from "@/lib/tms";

export type InvoiceMode = "individual" | "consolidated";

/** Loads that can be invoiced: delivered and not cancelled. */
export const invoiceable = (l: Load) => l.status === "delivered" || l.status === "invoiced";
export type InvoiceKind = "invoice" | "fleet_invoice";
/** Default billing company: our own trucks bill through Foust Farms, everything else through Clearwater. */
export const invoiceKind = (l: Load): InvoiceKind => {
  const b = (l as Load & { bill_through?: string | null }).bill_through;
  if (b === "invoice" || b === "fleet_invoice") return b;
  return isFleetLoad(l) ? "fleet_invoice" : "invoice";
};
/** "auto" keeps each load's default; otherwise every load bills through the chosen company. */
export type BillThrough = "auto" | InvoiceKind;
export const kindFor = (l: Load, bill: BillThrough = "auto"): InvoiceKind => (bill === "auto" ? invoiceKind(l) : bill);

/** Why a consolidated invoice is not possible for this selection, or null when it is. */
export function consolidateProblem(loads: Load[], bill: BillThrough = "auto"): string | null {
  if (loads.length < 2) return "Pick at least two loads to combine.";
  if (new Set(loads.map((l) => l.customer_id ?? "")).size > 1) return "Combined invoices need every load to be for the same customer.";
  if (new Set(loads.map((l) => kindFor(l, bill))).size > 1) return "Foust Farms loads and brokerage loads must be invoiced separately — or pick one company to bill all of them.";
  return null;
}

/**
 * Queue customer invoices (AR) for the chosen loads. Individual = one invoice number per load;
 * consolidated = one invoice number shared by every load (one itemized invoice). Loads that already
 * have an invoice are skipped so nothing is duplicated. Marks delivered loads as invoiced.
 */
export async function queueInvoices(loads: Load[], companies: Company[], mode: InvoiceMode, bill: BillThrough = "auto") {
  if (!loads.length) return { queued: 0, skipped: 0, numbers: [] as string[] };
  if (loads.some((load) => !invoiceable(load) || load.closed_at)) throw new Error("Only delivered or invoiced, open loads can be invoiced.");
  const { data: existing, error: lookupError } = await supabase.from("qb_sync").select("load_id, kind").in("load_id", loads.map((l) => l.id)).in("kind", ["invoice", "fleet_invoice"]);
  if (lookupError) throw lookupError;
  const done = new Set((existing ?? []).map((e) => e.load_id));
  const todo = loads.filter((l) => !done.has(l.id));
  if (!todo.length) return { queued: 0, skipped: loads.length, numbers: [] as string[] };
  if (mode === "consolidated" && todo.length > 1) { const p = consolidateProblem(todo, bill); if (p) throw new Error(p); }
  const row = (l: Load, invoice_number?: string) => ({
    load_id: l.id,
    kind: kindFor(l, bill),
    payee: companies.find((c) => c.id === l.customer_id)?.name ?? "Unknown customer",
    amount: loadTotals(l).revenue,
    gross_amount: loadTotals(l).revenue,
    quickpay_fee: 0,
    status: "queued",
    ...(invoice_number ? { invoice_number } : {}),
  });
  const numbers: string[] = [];
  if (mode === "consolidated" && todo.length > 1) {
    const [first, ...rest] = todo;
    if (!first) throw new Error("No loads selected.");
    const { data, error } = await supabase.from("qb_sync").insert(row(first)).select("invoice_number").single();
    if (error) throw error;
    const num = data.invoice_number;
    if (!num) throw new Error("Invoice number was not assigned.");
    if (rest.length) { const { error: e2 } = await supabase.from("qb_sync").insert(rest.map((l) => row(l, num))); if (e2) throw e2; }
    numbers.push(num);
  } else {
    const { data, error } = await supabase.from("qb_sync").insert(todo.map((l) => row(l))).select("invoice_number");
    if (error) throw error;
    numbers.push(...(data ?? []).map((d) => d.invoice_number ?? ""));
  }
  const toMark = todo.filter((l) => l.status === "delivered").map((l) => l.id);
  if (toMark.length) {
    const { error } = await supabase.from("loads").update({ status: "invoiced" }).in("id", toMark).eq("status", "delivered");
    if (error) throw new Error(`Invoices created, but load status could not update: ${error.message}. Do not create them again; refresh Accounting.`);
  }
  return { queued: todo.length, skipped: loads.length - todo.length, numbers };
}
