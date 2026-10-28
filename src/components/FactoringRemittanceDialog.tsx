import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Landmark } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ActionButton } from "@/components/ActionGuard";
import { ReportExport } from "@/components/ReportExport";
import { LoadQuickLook } from "@/components/LoadQuickLook";
import { factoringBatches, type RemitBatch } from "@/lib/factoring";
import type { PayCarrier } from "@/lib/carrierPay";
import { usd, type Load } from "@/lib/tms";
import type { ReportSpec } from "@/lib/reportExport";

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US");

/** Owed loads of factored carriers, batched per factoring company: remittance schedule + mark paid. */
export function FactoringRemittanceDialog({ open, onOpenChange, loads, carriers, invoiced, canPay }: {
  open: boolean; onOpenChange: (o: boolean) => void; loads: Load[]; carriers: Map<string, PayCarrier>; invoiced: Set<string>; canPay: boolean;
}) {
  const batches = useMemo(() => (open ? factoringBatches(loads, carriers, invoiced) : []), [open, loads, carriers, invoiced]);
  const total = batches.reduce((t, b) => t + b.net, 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle>Factoring remittance</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Unpaid loads for carriers who factor, grouped by factoring company — one payment and one remittance schedule per factor, sent to the remit-to address from their Notice of Assignment.
          {batches.length > 0 && <> {batches.length} factor{batches.length === 1 ? "" : "s"} · {usd(total)} owed.</>}
        </p>
        {!batches.length && <div className="rounded border p-4 text-center text-sm text-muted-foreground">No factored carriers are waiting on payment.</div>}
        {batches.map((b) => <Batch key={b.key} b={b} canPay={canPay} />)}
      </DialogContent>
    </Dialog>
  );
}

function Batch({ b, canPay }: { b: RemitBatch; canPay: boolean }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<Set<string>>(() => new Set(b.rows.map((r) => r.load.id)));
  const [ref, setRef] = useState("");
  const chosen = b.rows.filter((r) => sel.has(r.load.id));
  const net = chosen.reduce((t, r) => t + r.net, 0);
  const spec = (): ReportSpec => ({
    title: `Remittance schedule — ${b.factor}`,
    subtitle: `Remit to: ${b.remit || "NO REMIT ADDRESS ON FILE"}`,
    filters: [`Prepared ${new Date().toLocaleDateString("en-US")}`, ...(ref.trim() ? [`Payment ref: ${ref.trim()}`] : [])],
    summary: [["Loads", String(chosen.length)], ["Carrier pay", usd(chosen.reduce((t, r) => t + r.gross, 0))], ["Quick Pay fees", usd(chosen.reduce((t, r) => t + r.fee, 0))], ["Net remitted", usd(net)]],
    head: ["Load", "Carrier (assignor)", "Delivered", "Customer ref #", "Carrier pay", "Fee", "Net"],
    right: [4, 5, 6],
    rows: chosen.map((r) => [r.load.load_number, r.carrier.legal_name, r.load.delivery_at ? new Date(r.load.delivery_at).toLocaleDateString("en-US") : "", r.load.customer_ref ?? "", usd(r.gross), r.fee ? usd(r.fee) : "", usd(r.net)]),
    total: ["Total", `${chosen.length} loads`, "", "", usd(chosen.reduce((t, r) => t + r.gross, 0)), usd(chosen.reduce((t, r) => t + r.fee, 0)), usd(net)],
  });
  const markPaid = async () => {
    const { error } = await supabase.from("loads").update({ carrier_paid_at: new Date().toISOString(), carrier_paid_ref: ref.trim() || null }).in("id", chosen.map((r) => r.load.id));
    if (error) return toast.error(error.message);
    toast.success(`Marked ${chosen.length} load(s) paid to ${b.factor}`);
    qc.invalidateQueries({ queryKey: ["loads"] });
    qc.invalidateQueries({ queryKey: ["carrier_pay_due"] });
  };
  return (
    <div className="space-y-2 rounded border bg-card p-3">
      <div className="flex flex-wrap items-start gap-2">
        <Landmark className="mt-0.5 h-4 w-4 text-gold" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{b.factor}</div>
          <div className={`rounded px-1.5 py-0.5 text-sm ${b.remit ? "bg-gold/15 font-medium text-gold" : "bg-destructive/15 text-destructive"}`}>Remit to: {b.remit || "No remit-to address on file — get it from the NOA before paying"}</div>
        </div>
        <div className="text-right"><div className="font-display text-2xl text-gold">{usd(b.net)}</div><div className="text-[11px] text-muted-foreground">{b.rows.length} load{b.rows.length === 1 ? "" : "s"}</div></div>
      </div>
      {b.remitConflict && <Warn>Carriers factoring with {b.factor} have different remit addresses on file. Confirm with the factor before paying — changed remit info is a common fraud sign.</Warn>}
      {b.noaMissing.length > 0 && <Warn>No Notice of Assignment on file for {b.noaMissing.join(", ")}. Don't pay the factor until the NOA is received.</Warn>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="w-8 py-1"><Checkbox checked={sel.size === b.rows.length} onCheckedChange={(v) => setSel(v === true ? new Set(b.rows.map((r) => r.load.id)) : new Set())} aria-label="Select all" /></th><th>Load</th><th>Carrier</th><th>Due</th><th className="text-right">Carrier pay</th><th className="text-right">Fee</th><th className="text-right">Net</th></tr></thead>
          <tbody>
            {b.rows.map((r) => (
              <tr key={r.load.id} className="border-t">
                <td className="py-1"><Checkbox checked={sel.has(r.load.id)} onCheckedChange={(v) => setSel((s) => { const n = new Set(s); if (v === true) n.add(r.load.id); else n.delete(r.load.id); return n; })} aria-label="Select" /></td>
                <td><LoadQuickLook load={r.load} /></td>
                <td className="max-w-48 truncate">{r.carrier.legal_name}</td>
                <td className={r.daysLeft < 0 ? "text-destructive" : ""}>{day(r.due)}{r.daysLeft < 0 ? ` (${-r.daysLeft}d late)` : ""}</td>
                <td className="text-right">{usd(r.gross)}</td>
                <td className="text-right">{r.fee ? usd(r.fee) : "—"}</td>
                <td className="text-right font-medium">{usd(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ReportExport build={() => (chosen.length ? spec() : null)} />
        {canPay && <>
          <Input className="h-8 w-48" placeholder="Check # / ACH ref" value={ref} onChange={(e) => setRef(e.target.value)} />
          <ActionButton size="sm" disabled={!chosen.length} hint="Records the ticked loads as paid to this factor. Doesn't send money or change QuickBooks."
            confirm={() => ({
              title: `Mark ${chosen.length} load${chosen.length === 1 ? "" : "s"} paid to ${b.factor}?`,
              body: `Total ${usd(net)}${ref.trim() ? ` · Ref ${ref.trim()}` : " · no check # / ACH ref entered"}.`,
              points: [
                "Records today as the carrier paid date on these loads, with your reference.",
                b.noaMissing.length ? `Warning: no NOA on file for ${b.noaMissing.join(", ")}.` : null,
                "This does not send money, and does not change QuickBooks or the customer invoice.",
                "The load status does not change.",
              ].filter(Boolean),
              confirmLabel: "Mark paid", danger: b.noaMissing.length > 0 || b.remitConflict,
            })}
            onClick={markPaid}>Mark paid ({usd(net)})</ActionButton>
        </>}
      </div>
    </div>
  );
}

const Warn = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-start gap-2 rounded border border-warning/50 bg-warning/10 p-2 text-xs"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /><span>{children}</span></div>
);
