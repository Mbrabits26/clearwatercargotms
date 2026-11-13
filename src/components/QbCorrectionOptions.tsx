import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Link2 } from "lucide-react";
import { qbCorrectionPreview, qbCorrectInvoices } from "@/lib/qbCorrection.functions";
import { qbFindExistingInvoice } from "@/lib/quickbooks.functions";
import type { CorrectionChoice } from "@/lib/qbCorrection";
import type { QbInvoice } from "@/lib/qbMatch";
import { usd } from "@/lib/tms";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { ActionButton } from "./ActionGuard";

type Other = Awaited<ReturnType<typeof qbCorrectionPreview>>["other"];
export function QbCorrectionOptions({ row, invoice, loadNumber, customerRef, onClose }: { row: { id: string; kind: string; qb_ref: string | null; invoice_number: string | null }; invoice?: QbInvoice; loadNumber?: string; customerRef?: string | null; onClose: () => void }) {
  const preview = useServerFn(qbCorrectionPreview), correct = useServerFn(qbCorrectInvoices), find = useServerFn(qbFindExistingInvoice);
  const qc = useQueryClient();
  const [others, setOthers] = useState<Other | null>(null);
  const [choice, setChoice] = useState<CorrectionChoice>("blank");
  const [kind, setKind] = useState(row.kind);
  const [number, setNumber] = useState("");
  const [candidates, setCandidates] = useState<QbInvoice[]>([]);
  const [replacement, setReplacement] = useState<QbInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    if (!invoice) return;
    setBusy(true);
    try { setOthers((await preview({ data: { rowId: row.id, qbId: invoice.id } })).other); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const search = async () => {
    setBusy(true); setReplacement(null);
    try { setCandidates((await find({ data: { rowId: row.id, value: number, by: "number" } })).invoices); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try {
      await correct({ data: { rowId: row.id, previousRef: row.qb_ref, qbId: invoice?.id, choice, replacementId: replacement?.id, otherRowIds: (others ?? []).map((r) => r.id), newKind: kind as "invoice" | "fleet_invoice" } });
      await qc.invalidateQueries({ queryKey: ["qb_sync"] });
      toast.success("Invoice correction saved. Amounts, payments and closeout unchanged."); onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  if (invoice && others === null) return <Button variant="outline" disabled={busy} onClick={check}><Link2 className="mr-1 h-4 w-4" />Check linked loads / correct both</Button>;
  const otherLoads = (others ?? []).map((r) => `${r.loads?.load_number ?? "Load"} · ref ${r.loads?.customer_ref || "—"} · ${usd(Number(r.amount))}`).join("; ");
  const hasOther = !!others?.length;
  return <div className="space-y-3 border-t pt-3 text-sm">
    {hasOther && <div><div className="font-semibold">Currently assigned to</div>{otherLoads}</div>}
    {(!invoice || hasOther) && <>
      <label className="block">{hasOther ? "Other load's invoice after the move" : "After removing this assignment"}<Select value={choice} onValueChange={(v) => { setChoice(v as CorrectionChoice); setReplacement(null); setKind(row.kind); }}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="blank">Leave blank — hold until verified</SelectItem>
        <SelectItem value="new">Assign a new FF- / INV- number</SelectItem>
        {hasOther && row.qb_ref && row.qb_ref !== invoice?.id && <SelectItem value="previous">Swap with this load's previous invoice {row.invoice_number}</SelectItem>}
        {hasOther && <SelectItem value="existing">Choose another existing QB invoice</SelectItem>}
      </SelectContent></Select></label>
      {choice === "new" && <label className="block">New invoice company<Select value={kind} onValueChange={setKind}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fleet_invoice">Foust Farms — FF-</SelectItem><SelectItem value="invoice">Clearwater Cargo — INV-</SelectItem></SelectContent></Select></label>}
      {choice === "existing" && <><div className="flex gap-2"><Input aria-label="Other load replacement invoice number" value={number} onChange={(e) => { setNumber(e.target.value); setReplacement(null); }} /><Button variant="outline" disabled={busy || !number.trim()} onClick={search}><Search className="mr-1 h-4 w-4" />Find replacement</Button></div>{candidates.map((i) => <div key={i.id} className="space-y-1 border-t pt-2"><div>{i.docNumber} · {i.customer} · {usd(i.total)}</div><div className="whitespace-pre-wrap">{i.text}</div><Button variant={replacement?.id === i.id ? "default" : "outline"} onClick={() => setReplacement(i)}>Use invoice {i.docNumber}</Button></div>)}</>}
    </>}
    <ActionButton disabled={busy || (choice === "existing" && hasOther && !replacement)} variant="outline" hint="Save verified invoice corrections together; preserve payments, amounts, documents and closed-out status." confirm={{ title: invoice ? "Confirm invoice correction for both loads?" : "Confirm invoice replacement choice?", body: `${loadNumber || "Current load"} · ref ${customerRef || "—"}${invoice ? ` → QB ${invoice.docNumber} · ${invoice.customer} · ${usd(invoice.total)}` : ""}`, points: [hasOther ? `Other affected loads: ${otherLoads}` : null, (!invoice || hasOther) ? choice === "blank" ? "Removed assignment stays blank and on hold." : choice === "new" ? `Allocate a new ${kind === "fleet_invoice" ? "FF-" : "INV-"} number, on hold. Nothing is sent to QuickBooks.` : choice === "previous" ? `Other loads receive previous QB invoice ${row.invoice_number}. Verify their references before confirming.` : `Other loads receive QB invoice ${replacement?.docNumber}. Verify their references before confirming.` : "Links only this invoice group.", invoice && Math.abs(invoice.total - (others ?? []).reduce((s, r) => s + Number(r.amount), 0)) > 0.01 && hasOther ? "Verify amounts and descriptions for every affected load before confirming." : null, "Both corrections save together or neither does. Amounts, payments, documents and closeout remain unchanged.", "Existing QuickBooks invoices are not deleted, edited or created."], confirmLabel: "Save correction" }} onClick={save}>{invoice ? "Save invoice correction" : "Remove assignment with chosen option"}</ActionButton>
  </div>;
}