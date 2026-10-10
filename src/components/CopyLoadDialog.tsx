import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import type { Load } from "@/lib/tms";

const DAY = 86_400_000;
const shift = (iso: string | null, ms: number) => (iso ? new Date(new Date(iso).getTime() + ms).toISOString() : null);

// Builds copy rows: same freight/lane/money, fresh carrier/paperwork, status available.
export function copyRows(base: Record<string, any>, offsets: number[], brokerId: string) {
  return offsets.map((ms) => ({
    customer_id: base.customer_id ?? null, shipper_id: base.shipper_id ?? null, consignee_id: base.consignee_id ?? null,
    origin_city: base.origin_city, origin_state: base.origin_state, dest_city: base.dest_city, dest_state: base.dest_state,
    pickup_at: shift(base.pickup_at ?? null, ms), delivery_at: shift(base.delivery_at ?? null, ms),
    equipment: base.equipment, commodity: base.commodity ?? null, weight_lbs: base.weight_lbs ?? null, pieces: base.pieces ?? null,
    temperature: base.temperature ?? null, miles: base.miles ?? null, pickup_notes: base.pickup_notes ?? null, delivery_notes: base.delivery_notes ?? null,
    customer_rate: base.customer_rate ?? 0, carrier_rate: base.carrier_rate ?? 0, accessorials: base.accessorials ?? [],
    ship_ref: base.ship_ref ?? null, dest_ref: base.dest_ref ?? null, pay_terms: base.pay_terms ?? null,
    status: "available" as const, broker_id: brokerId,
  }));
}

export function CopyLoadDialog({ load }: { load: Load }) {
  const qc = useQueryClient();
  const { user } = useRouteContext({ from: "/_authenticated" });
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState("1");
  const [mode, setMode] = useState<"same" | "step" | "pick">("step");
  const [step, setStep] = useState("1");
  const [dates, setDates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const n = Math.max(1, Math.min(50, Number(count) || 1));
  const basePick = load.pickup_at ? new Date(load.pickup_at).getTime() : null;

  const save = async () => {
    let offsets: number[];
    if (mode === "same") offsets = Array.from({ length: n }, () => 0);
    else if (mode === "step") offsets = Array.from({ length: n }, (_, i) => (i + 1) * (Number(step) || 0) * DAY);
    else {
      if (basePick == null) return toast.error("This load has no pickup date to move from — use 'Same dates' or set a pickup first.");
      const picked = Array.from({ length: n }, (_, i) => dates[i]);
      if (picked.some((d) => !d)) return toast.error("Pick a date for every copy.");
      offsets = picked.map((d) => new Date(d!).getTime() - basePick);
    }
    setSaving(true);
    const { data, error } = await supabase.from("loads").insert(copyRows(load, offsets, user.id)).select("load_number");
    setSaving(false);
    if (error) return toast.error(error.message);
    const nums = (data ?? []).map((r) => r.load_number);
    toast.success(`Created ${nums.length} load${nums.length > 1 ? "s" : ""}: ${nums.length > 1 ? `${nums[0]} to ${nums[nums.length - 1]}` : nums[0]}`);
    qc.invalidateQueries({ queryKey: ["loads"] });
    setOpen(false);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Copy className="mr-1 h-3.5 w-3.5" />Copy load</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Copy {load.load_number}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Copies keep the customer, lane, freight, rates and notes. Carrier, truck, driver, rate con, tracking and documents start fresh. Each copy starts as Available.</p>
          <label className="block text-xs text-muted-foreground">How many copies (1–50)
            <Input className="mt-1" type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">Pickup dates
            <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="same">Same dates as this load</SelectItem>
                <SelectItem value="step">Move each copy forward</SelectItem>
                <SelectItem value="pick">Pick a date for each copy</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {mode === "step" && (
            <label className="block text-xs text-muted-foreground">Days between copies (1 = daily, 7 = weekly)
              <Input className="mt-1" type="number" min={0} value={step} onChange={(e) => setStep(e.target.value)} />
            </label>
          )}
          {mode === "pick" && (
            <div className="space-y-2">
              {Array.from({ length: n }, (_, i) => (
                <label key={i} className="block text-xs text-muted-foreground">Copy {i + 1} pickup
                  <div className="mt-1"><DatePicker withTime value={dates[i] ?? ""} onChange={(v) => setDates((p) => { const c = [...p]; c[i] = v; return c; })} /></div>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Delivery dates move along with pickup.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Creating…" : `Create ${n} load${n > 1 ? "s" : ""}`}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
