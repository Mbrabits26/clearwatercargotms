import type { Load } from "@/lib/tms";

export type AccountingLoadScope = "active" | "history" | "all";

/** Viewing history never changes load status, closeout, payment or invoice data. */
export function accountingLoadInScope(load: Pick<Load, "status" | "closed_at">, scope: AccountingLoadScope) {
  if (load.status === "cancelled") return false;
  const historical = load.status === "paid" || !!load.closed_at;
  const completed = ["delivered", "invoiced", "paid"].includes(load.status) || !!load.closed_at;
  return scope === "history" ? historical : scope === "active" ? completed && !historical : completed;
}