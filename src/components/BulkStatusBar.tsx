import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { STATUSES, statusMeta, type Load, type LoadStatus } from "@/lib/tms";
import { BULK_TARGETS, bulkStatusSkip } from "@/lib/bulkStatus";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ActionGuard";

const EARLY: LoadStatus[] = ["available", "vetting", "booked", "dispatched", "rolling", "issue"];

/** "N selected · Change status to [..]" bar for checked loads. Each load is updated on its own, so the load safety rules apply per load. */
export function BulkStatusBar({ loads, total, onClear }: { loads: Load[]; total: number; onClear: () => void }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<LoadStatus | "">("");
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  if (!loads.length) return null;
  const t = target || null;
  const willTry = t ? loads.filter((l) => !bulkStatusSkip(l, t)) : [];
  const skipped = t ? loads.length - willTry.length : 0;
  const label = t ? statusMeta(t).label : "";

  const points = () => {
    if (!t) return [];
    const p: string[] = [`${willTry.length} load${willTry.length === 1 ? "" : "s"} will change to ${label}.${skipped ? ` ${skipped} will be skipped (already ${label}, cancelled, or closed out).` : ""}`];
    if (t === "delivered") p.push(`${willTry.filter((l) => !l.pod_received).length} have no POD on file — this does not mark the POD received.`);
    if (t === "invoiced") p.push("This only changes the status. It does not create or send an invoice; the loads go on the finance review list for QuickBooks.");
    if (t === "paid") p.push("Completed / Paid means the customer paid. Loads without a customer invoice on file will be refused. Carrier pay is not marked paid.");
    if (EARLY.includes(t) && willTry.some((l) => ["delivered", "invoiced", "paid"].includes(l.status))) p.push("Some loads are moving backward from Delivered/Invoiced/Paid. Their invoices and QuickBooks records stay as they are.");
    p.push("Each load still has to pass the normal load rules (carrier, truck, dates). Any that don't are listed after.");
    return p;
  };

  const go = async () => {
    if (!t || !willTry.length) return;
    setErrors([]);
    const ok: string[] = [], bad: string[] = [];
    let i = 0;
    const worker = async () => {
      while (i < willTry.length) {
        const l = willTry[i++]!;
        setBusy(`${ok.length + bad.length + 1}/${willTry.length}`);
        const { data, error } = await supabase.from("loads").update({ status: t }).eq("id", l.id).select("id");
        if (error) bad.push(`${l.load_number}: ${error.message}`);
        else if (!data?.length) bad.push(`${l.load_number}: not allowed to change this load`);
        else ok.push(l.id);
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(6, willTry.length) }, worker)); }
    finally {
      setBusy("");
      await Promise.all([qc.invalidateQueries({ queryKey: ["loads"] }), qc.invalidateQueries({ queryKey: ["load-work"] })]);
    }
    if (ok.length) toast.success(`${ok.length} load${ok.length === 1 ? "" : "s"} changed to ${label}`);
    if (bad.length) toast.error(`${bad.length} load${bad.length === 1 ? "" : "s"} could not be changed`);
    setErrors(bad);
    if (!bad.length) { onClear(); setTarget(""); }
  };

  return (
    <div className="space-y-2 rounded-md border border-gold/50 bg-gold/5 p-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-gold">{loads.length} of {total} selected</span>
        <span className="text-muted-foreground">Change status to</span>
        <Select value={target} onValueChange={(v) => { setTarget(v as LoadStatus); setErrors([]); }}>
          <SelectTrigger className="h-8 w-48" aria-label="New status"><SelectValue placeholder="Pick a status" /></SelectTrigger>
          <SelectContent>{STATUSES.filter((s) => BULK_TARGETS.includes(s.value)).map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
        <ActionButton size="sm" disabled={!t || !willTry.length || !!busy}
          hint={t ? `Changes the checked loads to ${label}. Loads already ${label}, cancelled or closed out are skipped.` : "Pick a status first."}
          confirm={() => (t ? { title: `Change ${willTry.length} load${willTry.length === 1 ? "" : "s"} to ${label}?`, points: points(), confirmLabel: `Change to ${label}` } : null)}
          onClick={go}>{busy ? `Updating ${busy}…` : "Apply"}</ActionButton>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { onClear(); setErrors([]); }}>Clear selection</Button>
        {t && skipped > 0 && <span className="text-xs text-muted-foreground">{skipped} will be skipped</span>}
      </div>
      {!!errors.length && <div role="alert" className="max-h-40 overflow-auto rounded border border-destructive/40 p-2 text-xs text-destructive">{errors.map((e, k) => <p key={k}>{e}</p>)}</div>}
    </div>
  );
}
