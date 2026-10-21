import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { consolidateProblem, invoiceKind, kindFor, queueInvoices, type BillThrough, type InvoiceMode } from "@/lib/batchInvoice";
import { loadTotals, usd, type Company, type Load } from "@/lib/tms";
import { cn } from "@/lib/utils";

/** Choose individual or one combined invoice for the selected delivered loads, then queue them. */
export function BatchInvoiceDialog({ loads, companies, open, onOpenChange, onDone }: { loads: Load[]; companies: Company[]; open: boolean; onOpenChange: (v: boolean) => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const [bill, setBill] = useState<BillThrough>("auto");
  const problem = consolidateProblem(loads, bill);
  const [mode, setMode] = useState<InvoiceMode>("individual");
  const [busy, setBusy] = useState(false);
  const total = loads.reduce((s, l) => s + loadTotals(l).revenue, 0);
  const fleet = loads.filter((l) => kindFor(l, bill) === "fleet_invoice").length;
  const moved = loads.filter((l) => kindFor(l, bill) !== invoiceKind(l)).length;

  const go = async () => {
    setBusy(true);
    try {
      const r = await queueInvoices(loads, companies, problem ? "individual" : mode, bill);
      toast.success(r.queued ? `Created ${r.numbers.filter(Boolean).join(", ")}${r.skipped ? ` · ${r.skipped} already invoiced, skipped` : ""}` : "All selected loads already have invoices.");
      qc.invalidateQueries({ queryKey: ["qb_sync"] });
      qc.invalidateQueries({ queryKey: ["loads"] });
      qc.invalidateQueries({ queryKey: ["load-work"] });
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      qc.invalidateQueries({ queryKey: ["qb_sync"] });
      qc.invalidateQueries({ queryKey: ["loads"] });
      qc.invalidateQueries({ queryKey: ["load-work"] });
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Invoice {loads.length} load{loads.length === 1 ? "" : "s"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="max-h-40 overflow-auto rounded border">
            {loads.map((l) => (
              <div key={l.id} className="flex justify-between border-b px-2 py-1 text-xs last:border-0">
                <span className="font-mono text-gold">{l.load_number}</span>
                <span className="truncate px-2 text-muted-foreground">{companies.find((c) => c.id === l.customer_id)?.name ?? "—"}</span>
                <span>{usd(loadTotals(l).revenue)}</span>
              </div>
            ))}
          </div>
          <div className="text-right font-semibold">Total {usd(total)}</div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Bill the customer through</div>
            <div className="grid grid-cols-3 gap-2">
              {([["auto", "Automatic", "Our trucks → Foust, others → Clearwater"], ["invoice", "Clearwater Cargo", "INV- number, Clearwater QuickBooks"], ["fleet_invoice", "Foust Farms", "FF- number, Foust QuickBooks"]] as const).map(([v, name, sub]) => (
                <button key={v} type="button" onClick={() => setBill(v)}
                  className={cn("rounded border p-2 text-left text-xs", bill === v && "border-gold bg-gold/10")}>
                  <div className="font-semibold">{name}</div>
                  <div className="text-muted-foreground">{sub}</div>
                </button>
              ))}
            </div>
          </div>
          {fleet > 0 && <p className="text-xs text-teal">{fleet} load{fleet === 1 ? "" : "s"} will be billed by Foust Farms (FF- number, Foust letterhead, Foust QuickBooks).</p>}
          {moved > 0 && <p className="text-xs text-warning">{moved} load{moved === 1 ? "" : "s"} will bill through a different company than usual. Outside-carrier bills still go to Clearwater Cargo, and load margins are unchanged.</p>}
          <div className="grid grid-cols-2 gap-2">
            {(["individual", "consolidated"] as const).map((m) => {
              const disabled = m === "consolidated" && !!problem;
              return (
                <button key={m} type="button" disabled={disabled} onClick={() => setMode(m)}
                  className={cn("rounded border p-2 text-left text-xs", mode === m && !disabled ? "border-gold bg-gold/10" : "", disabled && "opacity-40")}>
                  <div className="font-semibold">{m === "individual" ? "One invoice per load" : "One combined invoice"}</div>
                  <div className="text-muted-foreground">{m === "individual" ? "Each load gets its own number" : "Itemized, same customer"}</div>
                </button>
              );
            })}
          </div>
          {problem && loads.length > 1 && <p className="text-xs text-muted-foreground">{problem}</p>}
          <Button className="w-full" disabled={busy || !loads.length} onClick={go}>{busy ? "Creating…" : "Create invoices"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
