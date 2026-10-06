import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EQUIPMENT, type Company } from "@/lib/tms";

type F = Record<string, string>;

export function LoadBuilderDialog({
  open, onOpenChange, companies, onCreated,
}: { open: boolean; onOpenChange: (o: boolean) => void; companies: Company[]; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const { user } = useRouteContext({ from: "/_authenticated" });
  const [f, setF] = useState<F>({ equipment: "Dry Van" });
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const pick = (kind: string, key: string) => (
    <Select
      value={f[key] ?? ""}
      onValueChange={(v) => {
        const c = companies.find((x) => x.id === v);
        setF((p) => ({
          ...p,
          [key]: v,
          ...(kind === "shipper" && c ? { origin_city: c.city ?? "", origin_state: c.state ?? "" } : {}),
          ...(kind === "consignee" && c ? { dest_city: c.city ?? "", dest_state: c.state ?? "" } : {}),
        }));
      }}
    >
      <SelectTrigger><SelectValue placeholder={`Select ${kind}`} /></SelectTrigger>
      <SelectContent>
        {companies.filter((c) => c.kind === kind).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="block text-xs text-muted-foreground">{label}<div className="mt-1">{children}</div></label>
  );

  const save = async () => {
    if (!f.origin_city || !f.origin_state || !f.dest_city || !f.dest_state) return toast.error("Origin and destination are required.");
    const num = (k: string) => (f[k] ? Number(f[k]) : null);
    const { data, error } = await supabase
      .from("loads")
      .insert({
        broker_id: user.id,
        customer_id: f.customer_id || null,
        shipper_id: f.shipper_id || null,
        consignee_id: f.consignee_id || null,
        origin_city: f.origin_city, origin_state: f.origin_state.toUpperCase(),
        dest_city: f.dest_city, dest_state: f.dest_state.toUpperCase(),
        pickup_at: f.pickup_at ? new Date(f.pickup_at).toISOString() : null,
        delivery_at: f.delivery_at ? new Date(f.delivery_at).toISOString() : null,
        equipment: f.equipment ?? "Dry Van", commodity: f.commodity || null,
        weight_lbs: num("weight_lbs"), pieces: num("pieces"), miles: num("miles"),
        temperature: f.temperature || null,
        pickup_notes: f.pickup_notes || null, delivery_notes: f.delivery_notes || null,
        customer_rate: num("customer_rate") ?? 0, carrier_rate: num("carrier_rate") ?? 0,
      })
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    toast.success("Load created");
    qc.invalidateQueries({ queryKey: ["loads"] });
    onCreated(data.id);
    setF({ equipment: "Dry Van" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Load builder</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <L label="Customer (bill-to)">{pick("customer", "customer_id")}</L>
          <L label="Shipper">{pick("shipper", "shipper_id")}</L>
          <L label="Consignee">{pick("consignee", "consignee_id")}</L>
          <L label="Origin city"><Input value={f.origin_city ?? ""} onChange={set("origin_city")} /></L>
          <L label="Origin state"><Input maxLength={2} value={f.origin_state ?? ""} onChange={set("origin_state")} /></L>
          <L label="Miles"><Input type="number" value={f.miles ?? ""} onChange={set("miles")} /></L>
          <L label="Destination city"><Input value={f.dest_city ?? ""} onChange={set("dest_city")} /></L>
          <L label="Destination state"><Input maxLength={2} value={f.dest_state ?? ""} onChange={set("dest_state")} /></L>
          <L label="Equipment">
            <Select value={f.equipment} onValueChange={(v) => setF((p) => ({ ...p, equipment: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EQUIPMENT.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
            </Select>
          </L>
          <L label="Pickup appointment"><Input type="datetime-local" value={f.pickup_at ?? ""} onChange={set("pickup_at")} /></L>
          <L label="Delivery appointment"><Input type="datetime-local" value={f.delivery_at ?? ""} onChange={set("delivery_at")} /></L>
          <L label="Temperature"><Input placeholder="e.g. 34°F" value={f.temperature ?? ""} onChange={set("temperature")} /></L>
          <L label="Commodity"><Input value={f.commodity ?? ""} onChange={set("commodity")} /></L>
          <L label="Weight (lbs)"><Input type="number" value={f.weight_lbs ?? ""} onChange={set("weight_lbs")} /></L>
          <L label="Pieces"><Input type="number" value={f.pieces ?? ""} onChange={set("pieces")} /></L>
          <L label="Customer rate ($)"><Input type="number" value={f.customer_rate ?? ""} onChange={set("customer_rate")} /></L>
          <L label="Target carrier pay ($)"><Input type="number" value={f.carrier_rate ?? ""} onChange={set("carrier_rate")} /></L>
          <div />
          <div className="col-span-3 grid grid-cols-2 gap-3">
            <L label="Pickup facility notes"><Textarea value={f.pickup_notes ?? ""} onChange={set("pickup_notes")} /></L>
            <L label="Delivery facility notes"><Textarea value={f.delivery_notes ?? ""} onChange={set("delivery_notes")} /></L>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Create load</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
