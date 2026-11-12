/** Combined invoices are reviewed once, in selection order, and never across companies. */
export function accountingInvoiceKey(row: { id: string; kind: string; invoice_number: string | null; qb_ref?: string | null }) {
  return row.invoice_number ? `${row.kind}:${row.invoice_number}:${row.qb_ref ?? "unlinked"}` : row.id;
}

export function uniqueAccountingInvoices<T extends { id: string; kind: string; invoice_number: string | null; qb_ref?: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = accountingInvoiceKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Actions act on checked rows still inside the current filtered list. */
export function checkedAccountingRows<T extends { id: string }>(rows: T[], picked: readonly string[]): T[] {
  const ids = new Set(picked);
  return rows.filter((row) => ids.has(row.id));
}

/** Validate shared invoice edits before any selected record is changed. */
export function accountingBulkPatch(field: "payee" | "amount" | "due_date" | "deductions", value: string) {
  if (field === "payee") {
    if (!value.trim()) throw new Error("Enter a payee / customer name.");
    return { payee: value.trim() };
  }
  if (field === "amount") {
    const amount = Number(value);
    if (!value.trim() || !Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid non-negative amount.");
    return { amount };
  }
  if (field === "due_date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Enter a valid due date as YYYY-MM-DD.");
    return { due_date: value };
  }
  const pct = Number(value);
  if (!value.trim() || !Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("Enter a deduction percentage from 0 to 100.");
  return { deductions: pct === 0 ? [] : [{ label: "QuickPay fee", pct }] };
}