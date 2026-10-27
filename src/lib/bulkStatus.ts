import type { Load, LoadStatus } from "@/lib/tms";

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
