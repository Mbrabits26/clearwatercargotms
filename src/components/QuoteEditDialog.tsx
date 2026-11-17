import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EQUIPMENT } from "@/lib/tms";
import type { Quote } from "@/lib/quote";
import { AccList } from "@/components/bids/AccEditor";
import type { BidAcc } from "@/lib/bidDesk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/DatePicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ROUND = "ROUND TRIP";

/** Edit a saved quote: lane, rate, extra charges, and notes (e.g. round trip, driver assist). */
export function QuoteEditButton({ q }: { q: Quote }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" aria-label="Edit quote" title="Edit quote" onClick={() => setOpen(true)}><Pencil className="h-4 w-4" /></Button>
      {open && <QuoteEditDialog q={q} onClose={() => setOpen(false)} />}
    </>
  );
}

function QuoteEditDialog({ q, onClose }: { q: Quote; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    customer_email: q.customer_email ?? "", kind: q.kind, origin_city: q.origin_city, origin_state: q.origin_state, dest_city: q.dest_city, dest_state: q.dest_state,
    equipment: q.equipment, miles: q.miles ? String(q.miles) : "", pickup_date: q.pickup_date ?? "", rate: String(q.rate ?? ""),
    target_carrier_rate: q.target_carrier_rate != null ? String(q.target_carrier_rate) : "", notes: q.notes ?? "",
  });
  const [acc, setAcc] = useState<BidAcc[]>(((q.accessorials as BidAcc[] | null) ?? []));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const round = f.notes.toUpperCase().includes(ROUND);
  const addNote = (t: string) => setF((s) => ({ ...s, notes: s.notes.toUpperCase().includes(t.toUpperCase()) ? s.notes : [s.notes.trim(), t].filter(Boolean).join(". ") }));

  const save = async () => {
    if (!f.origin_city || f.origin_state.length !== 2 || !f.dest_city || f.dest_state.length !== 2) return toast.error("Origin and destination need a city and 2-letter state.");
    setBusy(true);
    const { error } = await supabase.from("quotes").update({
      customer_email: f.customer_email.trim() || null, kind: f.kind, origin_city: f.origin_city.trim(), origin_state: f.origin_state.toUpperCase(),
      dest_city: f.dest_city.trim(), dest_state: f.dest_state.toUpperCase(), equipment: f.equipment, miles: f.miles ? Number(f.miles) : null,
      pickup_date: f.pickup_date || null, rate: Number(f.rate || 0), target_carrier_rate: f.target_carrier_rate ? Number(f.target_carrier_rate) : null,
      notes: f.notes.trim() || null, accessorials: acc as never,
    }).eq("id", q.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Quote updated");
    qc.invalidateQueries({ queryKey: ["quotes"] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Edit quote {q.quote_number}{q.customer_name ? ` — ${q.customer_name}` : ""}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <label className="col-span-2">Customer email<Input value={f.customer_email} onChange={set("customer_email")} /></label>
          <label>Origin city<Input value={f.origin_city} onChange={set("origin_city")} /></label>
          <label>ST<Input maxLength={2} value={f.origin_state} onChange={set("origin_state")} /></label>
          <label>Destination city<Input value={f.dest_city} onChange={set("dest_city")} /></label>
          <label>ST<Input maxLength={2} value={f.dest_state} onChange={set("dest_state")} /></label>
          <label>Equipment<select value={f.equipment} onChange={set("equipment")} className="h-9 w-full rounded border bg-background px-2 text-sm text-foreground">{EQUIPMENT.map((e) => <option key={e}>{e}</option>)}</select></label>
          <label>Type<select value={f.kind} onChange={set("kind")} className="h-9 w-full rounded border bg-background px-2 text-sm text-foreground"><option value="spot">Spot</option><option value="contract">Contract</option></select></label>
          <label>Miles<Input type="number" value={f.miles} onChange={set("miles")} /></label>
          <div>Pickup date<DatePicker value={f.pickup_date} onChange={(v) => setF((s) => ({ ...s, pickup_date: v }))} placeholder="Pickup date" /></div>
          <label>Quote rate $ (linehaul to customer)<Input type="number" value={f.rate} onChange={set("rate")} /></label>
          <label>Target carrier pay $<Input type="number" value={f.target_carrier_rate} onChange={set("target_carrier_rate")} /></label>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Quick add to notes</div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant={round ? "default" : "outline"} onClick={() => addNote(`${ROUND} — ${f.origin_city}, ${f.origin_state.toUpperCase()} → ${f.dest_city}, ${f.dest_state.toUpperCase()} → back to ${f.origin_city}, ${f.origin_state.toUpperCase()}`)}>Round trip</Button>
            <Button size="sm" variant="outline" onClick={() => addNote("Driver assist load")}>Driver assist load</Button>
            <Button size="sm" variant="outline" onClick={() => addNote("Driver assist unload")}>Driver assist unload</Button>
            <Button size="sm" variant="outline" onClick={() => addNote("Driver must bring own pallet jack")}>Own pallet jack</Button>
          </div>
          <Textarea rows={4} placeholder="Notes the customer sees on the quote" value={f.notes} onChange={set("notes")} />
        </div>
        <div className="rounded border p-2"><div className="mb-1 text-xs text-muted-foreground">Extra charges (shown on the quote)</div><AccList value={acc} onChange={setAcc} /></div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={save}>Save changes</Button></div>
      </DialogContent>
    </Dialog>
  );
}
