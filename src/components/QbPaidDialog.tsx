import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ActionGuard";
import { qbPaidCheck, qbMarkPaid, type PaidItem } from "@/lib/qbPaid.functions";
import { usd } from "@/lib/tms";

export function QbPaidDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const check = useServerFn(qbPaidCheck), mark = useServerFn(qbMarkPaid);
  const qc = useQueryClient(); const ask = useConfirm();
  const [items, setItems] = useState<PaidItem[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [closeout, setCloseout] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await check(); setItems(r.items); setSkipped(r.skipped); setPicked(new Set(r.items.map((i) => i.loadId))); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const go = async () => {
    const ids = [...picked]; if (!ids.length) return;
    if (!(await ask({ title: `Mark ${ids.length} load${ids.length > 1 ? "s" : ""} customer paid?`, points: ["QuickBooks is checked again first; only invoices with $0 balance are marked.", closeout ? "The loads are also closed out (note: Customer paid in QuickBooks)." : "The loads stay open and show in Ready for closeout.", "Carrier pay is not touched. Nothing changes in QuickBooks."], confirmLabel: "Mark paid" }))) return;
    setBusy(true);
    try {
      const { results } = await mark({ data: { loadIds: ids, closeout } });
      const good = results.filter((r) => r.ok).map((r) => r.id);
      results.filter((r) => !r.ok).forEach((r) => toast.error(`${items?.find((i) => i.loadId === r.id)?.loadNumber}: ${r.error}`));
      if (good.length) toast.success(`${good.length} load${good.length > 1 ? "s" : ""} marked paid${closeout ? " and closed out" : ""}.`);
      setItems((x) => x?.filter((i) => !good.includes(i.loadId)) ?? null); setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["loads"] }); qc.invalidateQueries({ queryKey: ["load-work"] }); qc.invalidateQueries({ queryKey: ["qb_sync"] });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const all = !!items?.length && items.every((i) => picked.has(i.loadId));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>Customer payments from QuickBooks</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Reads both QuickBooks companies for invoices with a $0 balance whose loads aren't marked paid in the TMS. Reading changes nothing.</p>
        <Button onClick={run} disabled={busy}>{busy ? "Checking QuickBooks…" : items ? "Check again" : "Check QuickBooks payments"}</Button>
        {skipped.map((s) => <p key={s} className="text-xs text-warning">Skipped: {s}</p>)}
        {items && (items.length ? <>
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left"><tr><th className="p-2"><Checkbox aria-label="Select all" checked={all} onCheckedChange={(c) => setPicked(c ? new Set(items.map((i) => i.loadId)) : new Set())} /></th><th className="p-2">Load</th><th className="p-2">Invoice #</th><th className="p-2">Company</th><th className="p-2">Customer</th><th className="p-2 text-right">Amount</th><th className="p-2">TMS status</th></tr></thead>
              <tbody className="divide-y">{items.map((i) => <tr key={i.loadId}>
                <td className="p-2"><Checkbox aria-label={`Pick ${i.loadNumber}`} checked={picked.has(i.loadId)} onCheckedChange={(c) => setPicked((s) => { const n = new Set(s); c ? n.add(i.loadId) : n.delete(i.loadId); return n; })} /></td>
                <td className="p-2 font-medium">{i.loadNumber}</td><td className="p-2">{i.invoiceNumber}</td><td className="p-2">{i.entity === "fleet" ? "Foust Farms" : "Clearwater"}</td><td className="p-2">{i.customer}</td><td className="p-2 text-right">{usd(i.total)}</td><td className="p-2">{i.status}{i.closed ? " · closed" : ""}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={closeout} onCheckedChange={(c) => setCloseout(c === true)} />Also close out these loads</label>
          <Button onClick={go} disabled={busy || !picked.size}>Mark {picked.size} paid{closeout ? " & close out" : ""}</Button>
        </> : <p className="text-sm text-muted-foreground">No paid QuickBooks invoices waiting — every paid invoice is already marked paid in the TMS.</p>)}
      </DialogContent>
    </Dialog>
  );
}
