import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { batchEligible, type WorkLoad } from "@/lib/loadWork";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ActionGuard";

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
    {action === "delivered" && <div className="rounded border border-warning/50 bg-warning/10 p-2 text-xs"><p className="mb-1 font-semibold text-warning">What this does</p><ul className="list-disc space-y-0.5 pl-4">
      <li>Changes these loads' status to Delivered.</li>
      <li>{eligible.filter((l) => !l.pod_received).length} have no POD on file — it does not mark the POD received.</li>
      <li>Does not create invoices or send anything to QuickBooks.</li>
    </ul></div>}
    {action === "closeout" && <><div className="rounded border border-warning/50 bg-warning/10 p-2 text-xs"><p className="mb-1 font-semibold text-warning">What closeout does</p><ul className="list-disc space-y-0.5 pl-4">
      <li>Files the load away as finished: it leaves the active Dispatch board and the "ready for closeout" notice. Find it later with "Show all" or the Closed out view.</li>
      <li>Status stays the same — a Paid load stays Paid, an Invoiced load stays Invoiced.</li>
      <li>Nothing changes for the customer invoice, payments, carrier pay or QuickBooks. No invoices are created or sent.</li>
      <li>Your note is saved to the load's notes.</li>
      <li>A closed load can't be invoiced or have its status changed until you press "Reopen load" on it.</li>
      <li>If the carrier hasn't been marked paid, it still shows in Carriers to be paid.</li>
    </ul></div><Textarea aria-label="Closeout note" placeholder="Closeout reason — e.g. paid in QuickBooks, reviewed" value={note} onChange={(event) => setNote(event.target.value)} /></>}
    <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirm} onCheckedChange={(checked) => setConfirm(checked === true)} />I reviewed these loads and confirm this action.</label>
    {!!errors.length && <div role="alert" className="max-h-40 overflow-auto text-xs text-destructive">{errors.map((error, i) => <p key={i}>{error}</p>)}</div>}
    <Hint text={action === "delivered" ? "Marks the eligible loads Delivered." : "Closes out the eligible loads with your note. Status and payments stay as they are."}><Button className="w-full" disabled={busy || !confirm || !eligible.length || (action === "closeout" && !note.trim())} onClick={go}>{busy ? "Updating…" : `Confirm ${action === "delivered" ? "delivery" : "closeout"}`}</Button></Hint>
  </DialogContent></Dialog>;
}