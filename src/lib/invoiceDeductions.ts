/** Percentage deductions a customer takes off an invoice (QuickPay fee, accessorial adjustments…). */
export type Deduction = { label: string; pct: number };

export const DEDUCTION_PRESETS = ["QuickPay fee", "Detention adjustment", "Lumper adjustment", "Fuel surcharge adjustment", "Late delivery", "Claim / damage", "Other"];

const r2 = (n: number) => Math.round(n * 100) / 100;

export function parseDeductions(v: unknown): Deduction[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((d) => ({ label: String((d as Deduction)?.label ?? "").trim() || "Deduction", pct: Number((d as Deduction)?.pct) }))
    .filter((d) => Number.isFinite(d.pct) && d.pct > 0 && d.pct <= 100);
}

/** Each deduction as a negative dollar line, calculated on the invoice amount. */
export function deductionLines(amount: number, ds: unknown) {
  return parseDeductions(ds).map((d) => ({ label: `${d.label} (${d.pct}%)`, amount: -r2((Number(amount) * d.pct) / 100) }));
}

/** What the customer actually owes after deductions (never below $0). */
export function invoiceNet(amount: number, ds: unknown) {
  const off = deductionLines(amount, ds).reduce((s, l) => s + l.amount, 0);
  return Math.max(0, r2(Number(amount) + off));
}
