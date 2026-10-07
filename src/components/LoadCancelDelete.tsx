import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, RotateCcw, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const REASONS = ["Customer cancelled", "Carrier fell off", "TONU", "Duplicate entry", "Other"];

export function LoadCancelDelete({ load, canDelete, onDeleted }: { load: Load; canDelete: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<null | "cancel" | "delete">(null);
  const [reason, setReason] = useState(REASONS[0]!);
  const [note, setNote] = useState("");
  const [confirmNo, setConfirmNo] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["loads"] });

  const cancel = async () => {
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("loads").update({
      status: "cancelled", cancel_reason: note.trim() ? `${reason}: ${note.trim()}` : reason,
      cancelled_at: new Date().toISOString(), cancelled_by: u.user?.id ?? null,
    }).eq("id", load.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Load ${load.load_number} cancelled`);
    setMode(null); refresh();
  };
  const reopen = async () => {
    const { error } = await supabase.from("loads").update({ status: "available", cancel_reason: null, cancelled_at: null, cancelled_by: null }).eq("id", load.id);
    if (error) return toast.error(error.message);
    toast.success("Load reopened"); refresh();
  };
  const del = async () => {
    setBusy(true);
    const { error, count } = await supabase.from("loads").delete({ count: "exact" }).eq("id", load.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    if (!count) return toast.error("You don't have permission to delete this load.");
    toast.success(`Load ${load.load_number} deleted`);
    setMode(null); onDeleted(); refresh();
  };

  return (
    <>
      {load.status === "cancelled" ? (
        <Button size="sm" variant="outline" onClick={reopen}><RotateCcw className="mr-1 h-3.5 w-3.5" />Reopen</Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setMode("cancel")}><Ban className="mr-1 h-3.5 w-3.5" />Cancel load</Button>
      )}
      {canDelete && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setConfirmNo(""); setMode("delete"); }}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button>}

      <Dialog open={mode === "cancel"} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel load {load.load_number}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
            <Textarea placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="text-xs text-muted-foreground">The load stays in history and reports and can be reopened later.</p>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMode(null)}>Keep load</Button><Button disabled={busy} onClick={cancel}>Cancel load</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === "delete"} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete load {load.load_number}?</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>This permanently removes the load and its notes, offers, tracking links and rate con requests. Loads with a signed rate con, an invoice or a QuickBooks send can't be deleted — cancel those instead.</p>
            <label className="block">Type <b className="font-mono text-gold">{load.load_number}</b> to confirm
              <Input className="mt-1" value={confirmNo} onChange={(e) => setConfirmNo(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMode(null)}>Keep load</Button>
              <Button variant="destructive" disabled={busy || confirmNo.trim() !== load.load_number} onClick={del}>Delete permanently</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
