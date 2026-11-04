import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Log a check call with where the truck is, the ETA and a note; saved as a load note and stamps the last check call. */
export function CheckCallDialog({ loadId }: { loadId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [where, setWhere] = useState("");
  const [eta, setEta] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from("loads").update({ last_check_call: now }).eq("id", loadId);
    if (error) { setBusy(false); return toast.error(error.message); }
    const parts = [where && `Location: ${where}`, eta && `ETA: ${eta}`, note].filter(Boolean);
    if (parts.length) await supabase.from("load_notes").insert({ load_id: loadId, body: `Check call — ${parts.join(" · ")}` });
    qc.invalidateQueries({ queryKey: ["loads"] });
    qc.invalidateQueries({ queryKey: ["load-notes"] });
    qc.invalidateQueries({ queryKey: ["load_notes"] });
    setBusy(false); setOpen(false); setWhere(""); setEta(""); setNote("");
    toast.success("Check call logged");
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Phone className="mr-1 h-3.5 w-3.5" />Log check call</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Log check call</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs text-muted-foreground">Where is the truck? (city, state)<Input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Greensboro, NC" /></label>
          <label className="block text-xs text-muted-foreground">ETA<Input value={eta} onChange={(e) => setEta(e.target.value)} placeholder="Tomorrow 8 AM" /></label>
          <label className="block text-xs text-muted-foreground">Note<Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Rolling on I-40, no issues" /></label>
          <p className="text-[11px] text-muted-foreground">Saves the check call time; anything typed here is added to the load notes.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={save}>Save check call</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
