import { isFleetLoad, type Load, type LoadStatus } from "@/lib/tms";

/** Statuses offered in the bulk "Change status" menu. Cancelling needs a reason, so it's done one load at a time. */
export const BULK_TARGETS: LoadStatus[] = ["available", "vetting", "booked", "dispatched", "rolling", "issue", "delivered", "invoiced", "paid"];

/** Why a selected load is skipped for a bulk status change, or null when it will be tried. The database still has the final say. */
export function bulkStatusSkip(load: Pick<Load, "status" | "closed_at">, target: LoadStatus): string | null {
  if (!BULK_TARGETS.includes(target)) return "Cancel loads one at a time from the load";
  if (load.status === target) return "Already this status";
  if (load.status === "cancelled") return "Cancelled — restore it from the load first";
  if (load.closed_at && !["delivered", "invoiced", "paid"].includes(target)) return "Closed out — reopen it first";
  return null;
}

/** Warning-box lines for a bulk status change. */
export function statusWarnings(loads: Pick<Load, "status" | "closed_at" | "pod_received">[], target: LoadStatus, label: string): string[] {
  const willTry = loads.filter((l) => !bulkStatusSkip(l, target));
  const skipped = loads.length - willTry.length;
  const p: string[] = [`${willTry.length} load${willTry.length === 1 ? "" : "s"} will change to ${label}.${skipped ? ` ${skipped} will be skipped (already ${label}, cancelled, or closed out).` : ""}`];
  if (target === "delivered") p.push(`${willTry.filter((l) => !l.pod_received).length} have no POD on file — this does not mark the POD received.`);
  if (target === "invoiced") p.push("This only changes the status. It does not create or send an invoice; the loads go on the finance review list for QuickBooks.");
  if (target === "paid") p.push("Completed / Paid means the customer paid. Loads without a customer invoice on file will be refused. Carrier pay is not marked paid.");
  const early: LoadStatus[] = ["available", "vetting", "booked", "dispatched", "rolling", "issue"];
  if (early.includes(target) && willTry.some((l) => ["delivered", "invoiced", "paid"].includes(l.status))) p.push("Some loads are moving backward from Delivered/Invoiced/Paid. Their invoices and QuickBooks records stay as they are.");
  p.push("Each load still has to pass the normal load rules (carrier, truck, dates).");
  return p;
}

export type LoadListAct = "checkcall" | "pod" | "carrier_paid" | "closeout";
type ActLoad = Pick<Load, "status" | "closed_at" | "pod_received" | "carrier_paid_at" | "carrier_id" | "truck_id" | "driver_id">;
const FINISHED = ["delivered", "invoiced", "paid", "cancelled"];

/** Why a checked load is skipped for a list action (check call, POD, carrier paid, closeout), or null to try it. */
export function loadActSkip(l: ActLoad, act: LoadListAct, fleet = isFleetLoad(l)): string | null {
  if (l.status === "cancelled") return "Cancelled";
  if (act === "checkcall") return l.closed_at || FINISHED.includes(l.status) ? "Load is already delivered" : null;
  if (act === "pod") return l.pod_received ? "POD already marked received" : null;
  if (act === "closeout") return l.closed_at ? "Already closed out" : ["delivered", "invoiced", "paid"].includes(l.status) ? null : "Not delivered yet";
  if (l.carrier_paid_at) return "Carrier already marked paid";
  if (fleet) return "Company truck — no carrier to pay";
  if (!l.carrier_id) return "No carrier on this load";
  return ["delivered", "invoiced", "paid"].includes(l.status) ? null : "Not delivered yet";
}
