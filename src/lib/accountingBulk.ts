/** Combined invoices are reviewed once, in selection order, and never across companies. */
export function uniqueAccountingInvoices<T extends { id: string; kind: string; invoice_number: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.invoice_number ? `${row.kind}:${row.invoice_number}` : row.id;
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