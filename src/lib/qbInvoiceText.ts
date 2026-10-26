// Wording for customer invoice lines sent to QuickBooks. Pure so it can be tested.
export type InvoiceTextLoad = {
  load_number: string;
  origin_city: string | null;
  origin_state: string | null;
  dest_city: string | null;
  dest_state: string | null;
  customer_ref?: string | null;
};

export function laneText(l: InvoiceTextLoad): string {
  return `${l.load_number}: ${l.origin_city ?? ""}, ${l.origin_state ?? ""} to ${l.dest_city ?? ""}, ${l.dest_state ?? ""}`;
}

/** "Freight — CW-1: A, NC to B, VA — Customer ref # PO123" (ref part omitted when blank). */
export function freightLineText(l: InvoiceTextLoad): string {
  const ref = l.customer_ref?.trim();
  return `Freight — ${laneText(l)}${ref ? ` — Customer ref # ${ref}` : ""}`;
}

/** Customer ref #s for the invoice memo, deduped, in load order. */
export function customerRefs(loads: InvoiceTextLoad[]): string[] {
  return [...new Set(loads.map((l) => l.customer_ref?.trim()).filter((r): r is string => !!r))];
}
