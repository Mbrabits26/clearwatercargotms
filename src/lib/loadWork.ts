import type { Load } from "@/lib/tms";

export type WorkLoad = Pick<Load, "id" | "load_number" | "status" | "broker_id" | "delivery_at" | "source" | "pod_received" | "closed_at">;
export type WorkFilter = "delivery" | "invoice" | "closeout" | "closed";
export function needsWork(load: WorkLoad, filter: WorkFilter, invoiceIds: Set<string>, now = Date.now()) {
  if (filter === "closed") return !!load.closed_at;
  if (load.closed_at || load.status === "cancelled") return false;
  if (filter === "delivery") return ["available", "vetting", "booked", "dispatched", "rolling", "issue"].includes(load.status) && !!load.delivery_at && new Date(load.delivery_at).getTime() < now;
  if (filter === "invoice") return ["delivered", "invoiced"].includes(load.status) && !invoiceIds.has(load.id);
  return ["delivered", "invoiced", "paid"].includes(load.status) && (invoiceIds.has(load.id) || load.status === "paid");
}
export function batchEligible(load: WorkLoad, action: "delivered" | "closeout") {
  if (load.closed_at) return false;
  return action === "delivered"
    ? ["available", "vetting", "booked", "dispatched", "rolling", "issue"].includes(load.status)
    : ["delivered", "invoiced", "paid"].includes(load.status);
}