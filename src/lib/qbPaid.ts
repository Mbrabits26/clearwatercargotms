/** Customer-paid check: a TMS load counts as paid in QuickBooks only when every linked invoice row exists there with a zero balance. */
export type PaidRow = { loadId: string; qbRef: string; balance: number | null };
export function paidLoadIds(rows: PaidRow[]): Set<string> {
  const by = new Map<string, boolean>();
  for (const r of rows) {
    const ok = r.balance !== null && r.balance <= 0.004;
    by.set(r.loadId, (by.get(r.loadId) ?? true) && ok);
  }
  return new Set([...by].filter(([, ok]) => ok).map(([id]) => id));
}
