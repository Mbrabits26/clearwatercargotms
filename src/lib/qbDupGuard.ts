import { customerFit, textHasRef, type QbInvoice } from "./qbMatch";

export type DupLoad = { load_number: string; customer_ref?: string | null; ship_ref?: string | null };
export type DupHit = { kind: "same"; invoice: QbInvoice; why: string } | { kind: "maybe"; invoice: QbInvoice; why: string } | null;

/**
 * Before the TMS creates a customer invoice in QuickBooks, look for one that already exists.
 * "same": an invoice for this customer already names one of the loads (load #, customer ref #, shipper PO #) → link it, don't create.
 * "maybe": same customer and same total within 10 days, but no reference # → hold for a person to decide.
 */
export function findQbDuplicate(existing: QbInvoice[], customer: string, loads: DupLoad[], total: number, txnDate: string): DupHit {
  const sameCust = existing.filter((i) => customerFit(i.customer, customer) !== "different");
  for (const inv of sameCust) {
    const hay = `${inv.text} ${inv.docNumber ?? ""}`;
    for (const l of loads) {
      if (textHasRef(hay, l.load_number)) return { kind: "same", invoice: inv, why: `it names load ${l.load_number}` };
      if (textHasRef(inv.text, l.customer_ref)) return { kind: "same", invoice: inv, why: `it has customer ref # ${l.customer_ref}` };
      if (textHasRef(inv.text, l.ship_ref)) return { kind: "same", invoice: inv, why: `it has shipper PO # ${l.ship_ref}` };
    }
  }
  const t = new Date(txnDate).getTime();
  const maybe = sameCust.find((i) => customerFit(i.customer, customer) !== "unknown" && Math.abs(i.total - total) < 0.01 && i.date && Math.abs(new Date(i.date).getTime() - t) <= 10 * 86400_000);
  return maybe ? { kind: "maybe", invoice: maybe, why: "same customer and amount within 10 days" } : null;
}
