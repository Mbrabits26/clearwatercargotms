import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Link2 } from "lucide-react";
import { qbFindExistingInvoice, qbAssignExistingInvoice } from "@/lib/quickbooks.functions";
import type { QbInvoice } from "@/lib/qbMatch";
import { usd, fmtDate } from "@/lib/tms";
import { invoiceNet } from "@/lib/invoiceDeductions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ActionGuard";

type Row = { id: string; kind: string; invoice_number: string | null; qb_ref: string | null; payee: string | null; amount: number; deductions?: unknown };
export function QbManualLinkDialog({ row, groupTotal, groupSize, customerRef, onClose }: { row: Row; groupTotal: number; groupSize: number; customerRef?: string | null; onClose: () => void }) {
  const find = useServerFn(qbFindExistingInvoice);
  const assign = useServerFn(qbAssignExistingInvoice);
  const qc = useQueryClient();
  const [by, setBy] = useState<"number" | "id">("number");
  const [value, setValue] = useState("");
  const [invoices, setInvoices] = useState<QbInvoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true); setInvoices(null);
    try { setInvoices((await find({ data: { rowId: row.id, value, by } })).invoices); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const link = async (invoice: QbInvoice) => {
    setBusy(true);
    try {
      const result = await assign({ data: { rowId: row.id, qbId: invoice.id, previousRef: row.qb_ref } });
      await qc.invalidateQueries({ queryKey: ["qb_sync"] });
      toast.success(`Linked to QuickBooks invoice ${result.invoiceNumber}. No new invoice created.`); onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Assign existing QuickBooks invoice</DialogTitle></DialogHeader>
      <div className="space-y-1 text-sm"><div>{row.invoice_number} · {row.payee} · {usd(groupTotal)}</div><div className="text-muted-foreground">{row.kind === "fleet_invoice" ? "Foust Farms" : "Clearwater Cargo"} · Customer ref: {customerRef || "—"}{groupSize > 1 ? ` · ${groupSize} combined loads` : ""}</div><div className="text-muted-foreground">Current QuickBooks ID: {row.qb_ref || "Not linked"}</div></div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <label className="text-sm">Find by<Select value={by} onValueChange={(v) => { setBy(v as "number" | "id"); setInvoices(null); }}><SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="number">Invoice number</SelectItem><SelectItem value="id">QuickBooks internal ID</SelectItem></SelectContent></Select></label>
        <label className="min-w-40 flex-1 text-sm">{by === "number" ? "QuickBooks invoice number" : "QuickBooks internal ID"}<Input className="mt-1" value={value} onChange={(e) => { setValue(e.target.value); setInvoices(null); }} /></label>
        <Button type="submit" disabled={busy || !value.trim()}><Search className="mr-1 h-4 w-4" />{busy ? "Checking…" : "Find invoice"}</Button>
      </form>
      {invoices?.length === 0 && <div className="text-sm text-muted-foreground">No invoice found in this company.</div>}
      {invoices?.map((invoice) => <div key={invoice.id} className="space-y-2 border-t pt-3 text-sm">
        <div className="font-semibold">Invoice {invoice.docNumber} · {invoice.customer}</div>
        <div>{usd(invoice.total)} · Open balance {usd(invoice.balance)} · {invoice.date ? fmtDate(invoice.date) : "—"}</div>
        <div className="text-muted-foreground">QuickBooks internal ID: {invoice.id}</div>
        <div className="whitespace-pre-wrap break-words text-muted-foreground">{invoice.text || "No customer reference or description on this invoice."}</div>
        {Math.abs(invoice.total - groupTotal) > 0.01 && <div className="text-warning">Amount differs: TMS {usd(groupTotal)} / QuickBooks {usd(invoice.total)}.</div>}
        <ActionButton disabled={busy} hint="Assign this existing invoice and clear stale errors. No new invoice is sent." confirm={{ title: `Assign ${row.invoice_number} to QuickBooks invoice ${invoice.docNumber}?`, body: `${invoice.customer} · ${usd(invoice.total)} · QuickBooks ID ${invoice.id}`, points: [row.qb_ref && row.qb_ref !== invoice.id ? `Replaces the old QuickBooks link ${row.qb_ref}.` : "Links the TMS invoice to this existing QuickBooks invoice.", `${groupSize} load(s) will be marked sent in the TMS; stale invoice and attachment errors are cleared.`, "TMS amounts and load payment status stay unchanged. Nothing is created, deleted, or voided in QuickBooks.", "Documents already present are retained; any missing picked documents can upload on the next sync.", Math.abs(invoice.total - groupTotal) > 0.01 ? "Warning: the amounts differ. Verify the customer and reference before confirming." : null], confirmLabel: "Assign invoice" }} onClick={() => link(invoice)}><Link2 className="mr-1 h-4 w-4" />Assign invoice</ActionButton>
      </div>)}
    </DialogContent>
  </Dialog>;
}