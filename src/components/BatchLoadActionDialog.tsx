import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { batchEligible, type WorkLoad } from "@/lib/loadWork";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export function BatchLoadActionDialog({ action, loads, onClose, onDone }: {
  action: "delivered" | "closeout" | null; loads: WorkLoad[]; onClose: () => void; onDone: (ids: string[]) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const eligible = action ? loads.filter((load) => batchEligible(load, action)) : [];
  const go = async () => {
    if (!action || !confirm || !eligible.length) return;
    setBusy(true); setErrors([]);
    try {
      const succeeded: string[] = [], failures: string[] = [];
      for (let from = 0; from < eligible.length; from += 100) {
        const batch = eligible.slice(from, from + 100);
        const { data, error } = await supabase.rpc("batch_load_action", { _ids: batch.map((l) => l.id), _action: action, _note: note });
        if (error) { failures.push(error.message); break; }
        for (const result of data as unknown as { id: string; ok: boolean; error?: string }[]) {
          if (result.ok) succeeded.push(result.id);
          else failures.push(`${batch.find((l) => l.id === result.id)?.load_number ?? result.id}: ${result.error}`);
        }
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ["loads"] }), qc.invalidateQueries({ queryKey: ["load-work"] }), qc.invalidateQueries({ queryKey: ["load_notes"] })]);
      onDone(succeeded);
      if (succeeded.length) toast.success(`${succeeded.length} loads ${action === "delivered" ? "marked delivered" : "closed out"}`);
      setErrors(failures);
      if (!failures.length) onClose();
    } catch (error) { setErrors([(error as Error).message]); }
    finally { setBusy(false); }
  };
  return <Dialog open={!!action} onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{action === "delivered" ? "Mark delivered" : "Close out loads"}</DialogTitle></DialogHeader>
    <div className="max-h-52 overflow-auto divide-y rounded border text-xs">{eligible.map((load) => <div key={load.id} className="flex justify-between gap-3 p-2"><span className="font-mono text-gold">{load.load_number}</span><span>{load.status}{load.source === "its" ? " · ITS" : ""}</span></div>)}</div>
    <p className="text-sm">{eligible.length} eligible · {loads.length - eligible.length} skipped</p>
    {action === "delivered" && <p className="text-xs text-warning">{eligible.filter((l) => !l.pod_received).length} loads have no POD on file. Delivery does not mark POD received or create invoices.</p>}
    {action === "closeout" && <><p className="text-xs text-warning">Payment status stays unchanged. No invoices are created or sent to QuickBooks. Delivered loads closed without invoices leave the unfinished-load notices.</p><Textarea aria-label="Closeout note" placeholder="Closeout reason — e.g. already billed in ITS" value={note} onChange={(event) => setNote(event.target.value)} /></>}
    <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirm} onCheckedChange={(checked) => setConfirm(checked === true)} />I reviewed these loads and confirm this action.</label>
    {!!errors.length && <div role="alert" className="max-h-40 overflow-auto text-xs text-destructive">{errors.map((error, i) => <p key={i}>{error}</p>)}</div>}
    <Button disabled={busy || !confirm || !eligible.length || (action === "closeout" && !note.trim())} onClick={go}>{busy ? "Updating…" : `Confirm ${action === "delivered" ? "delivery" : "closeout"}`}</Button>
  </DialogContent></Dialog>;
}