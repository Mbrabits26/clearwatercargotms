import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Table = "companies" | "carriers" | "carrier_documents" | "drivers" | "fleet_units" | "leads" | "quotes" | "load_offers" | "load_tracking_tokens";

/** Shared delete with a type-to-confirm check. Every delete is recorded in the deletion log by the database. */
export function ConfirmDelete({ table, id, label, what, linked, invalidate, onDone, size = "icon" }: {
  table: Table; id: string; label: string; what: string; linked?: string | null; invalidate: string[]; onDone?: () => void; size?: "icon" | "sm";
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    const { error, count } = await supabase.from(table).delete({ count: "exact" }).eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    if (!count) return toast.error("You don't have permission to delete this.");
    toast.success(`${what} deleted`);
    setOpen(false);
    invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onDone?.();
  };
  return (
    <>
      <Button size={size} variant="ghost" className="text-destructive" title={`Delete ${what.toLowerCase()}`}
        onClick={(e) => { e.stopPropagation(); setTyped(""); setOpen(true); }}>
        <Trash2 className="h-4 w-4" />{size === "sm" && <span className="ml-1">Delete</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader><DialogTitle>Delete {what.toLowerCase()}?</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>This permanently removes <b>{label}</b>. It's recorded in the admin deletion log.</p>
            {linked && <p className="rounded border border-warning/40 bg-warning/10 p-2 text-warning">{linked}</p>}
            <label className="block">Type <b className="font-mono text-gold">{label}</b> to confirm
              <Input className="mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Keep it</Button>
              <Button variant="destructive" disabled={busy || typed.trim().toLowerCase() !== label.trim().toLowerCase()} onClick={del}>Delete permanently</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
