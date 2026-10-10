import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EQUIPMENT, type Company, type Load } from "@/lib/tms";
import { DatePicker } from "@/components/DatePicker";
import { EntityCombobox, type ComboValue } from "@/components/EntityCombobox";
import { extractLoadFromDoc } from "@/lib/extract.functions";
import type { Extracted } from "@/lib/extract.server";
import { cn } from "@/lib/utils";
import { copyRows } from "@/components/CopyLoadDialog";

type F = Record<string, string>;
type Kind = "customer" | "shipper" | "consignee";
type Party = ComboValue & { address?: string; city?: string; state?: string; zip?: string; phone?: string; contact_name?: string };
const EMPTY: Party = { id: null, name: "" };

const toB64 = (buf: ArrayBuffer) => {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

// Defined at module scope so inputs keep focus while typing (an inline component remounts every keystroke).
const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block text-xs text-muted-foreground">{label}<div className="mt-1">{children}</div></label>
);
const pad = (n: number) => String(n).padStart(2, "0");
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function LoadBuilderDialog({
  open, onOpenChange, companies, onCreated, editLoad,
}: { open: boolean; onOpenChange: (o: boolean) => void; companies: Company[]; onCreated: (id: string) => void; editLoad?: Load | null }) {
  const qc = useQueryClient();
  const { user } = useRouteContext({ from: "/_authenticated" });
  const extract = useServerFn(extractLoadFromDoc);
  const [f, setF] = useState<F>({ equipment: "Dry Van" });
  const [parties, setParties] = useState<Record<Kind, Party>>({ customer: EMPTY, shipper: EMPTY, consignee: EMPTY });
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState<Extracted[]>([]);
  const [foundIdx, setFoundIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string>("");
  useEffect(() => {
    if (!open || !editLoad) return;
    const s = (v: unknown) => (v == null ? "" : String(v));
    const l = editLoad;
    setF({
      origin_city: l.origin_city, origin_state: l.origin_state, dest_city: l.dest_city, dest_state: l.dest_state,
      pickup_at: toLocal(l.pickup_at), delivery_at: toLocal(l.delivery_at), equipment: l.equipment,
      commodity: s(l.commodity), weight_lbs: s(l.weight_lbs), pieces: s(l.pieces), temperature: s(l.temperature), miles: s(l.miles),
      customer_rate: s(l.customer_rate), carrier_rate: s(l.carrier_rate), pickup_notes: s(l.pickup_notes), delivery_notes: s(l.delivery_notes),
      ship_ref: s(l.ship_ref), dest_ref: s(l.dest_ref),
    });
    const p = (id: string | null): Party => { const c = companies.find((x) => x.id === id); return c ? { id: c.id, name: c.name } : EMPTY; };
    setParties({ customer: p(l.customer_id), shipper: p(l.shipper_id), consignee: p(l.consignee_id) });
    setFound([]); setHint("");
  }, [open, editLoad?.id]);
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const match = (kind: Kind, name: string | null) => {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    return companies.find((c) => c.kind === kind && c.name.toLowerCase() === n)
      ?? companies.find((c) => c.kind === kind && (c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase())) && c.name.length > 3) ?? null;
  };
  const party = (kind: Kind, name: string | null, extra: Omit<Party, "id" | "name"> = {}): Party => {
    const c = match(kind, name);
    return c ? { id: c.id, name: c.name } : { id: null, name: name?.trim() ?? "", ...extra };
  };

  const apply = (x: Extracted) => {
    const s = (v: string | number | null) => (v == null ? "" : String(v));
    const eq = EQUIPMENT.find((e) => x.equipment && e.toLowerCase() === x.equipment.toLowerCase());
    setF((p) => ({
      ...p,
      origin_city: s(x.origin_city), origin_state: s(x.origin_state).toUpperCase(),
      dest_city: s(x.dest_city), dest_state: s(x.dest_state).toUpperCase(),
      pickup_at: s(x.pickup_at).slice(0, 16), delivery_at: s(x.delivery_at).slice(0, 16),
      equipment: eq ?? p.equipment ?? "Dry Van", commodity: s(x.commodity), weight_lbs: s(x.weight_lbs),
      pieces: s(x.pieces), temperature: s(x.temperature), miles: s(x.miles),
      customer_rate: s(x.customer_rate), carrier_rate: s(x.carrier_rate),
      ship_ref: s(x.ship_ref), dest_ref: s(x.dest_ref),
      pickup_notes: [x.reference && `Ref: ${x.reference}`, x.po_number && `PO: ${x.po_number}`, x.hazmat && "HAZMAT",
        (x.shipper_contact || x.shipper_phone) && `Contact: ${[x.shipper_contact, x.shipper_phone].filter(Boolean).join(" ")}`, x.pickup_notes].filter(Boolean).join("\n"),
      delivery_notes: [(x.consignee_contact || x.consignee_phone) && `Contact: ${[x.consignee_contact, x.consignee_phone].filter(Boolean).join(" ")}`, x.delivery_notes].filter(Boolean).join("\n"),
    }));
    setHint([x.carrier_name && `Suggested carrier: ${x.carrier_name}${x.carrier_mc ? ` (MC ${x.carrier_mc})` : ""} — assign it on the Carrier tab after saving`, x.handwritten_notes && `Handwritten: ${x.handwritten_notes}`].filter(Boolean).join(" · "));
    setParties({
      customer: party("customer", x.customer_name),
      shipper: party("shipper", x.shipper_name, { address: x.shipper_address ?? "", city: x.origin_city ?? "", state: x.origin_state ?? "", zip: x.origin_zip ?? "", phone: x.shipper_phone ?? "", contact_name: x.shipper_contact ?? "" }),
      consignee: party("consignee", x.consignee_name, { address: x.consignee_address ?? "", city: x.dest_city ?? "", state: x.dest_state ?? "", zip: x.dest_zip ?? "", phone: x.consignee_phone ?? "", contact_name: x.consignee_contact ?? "" }),
    });
  };

  const readDoc = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("Files must be 10 MB or smaller.");
    setReading(true);
    try {
      const buf = await file.arrayBuffer();
      const name = file.name.toLowerCase();
      let payload: { fileName: string; mime: string; base64: string | null; text: string | null };
      if (/\.(xlsx|xls|csv)$/.test(name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        const text = wb.SheetNames.map((n) => `Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n]!)}`).join("\n\n");
        payload = { fileName: file.name, mime: "text/csv", base64: null, text: text.slice(0, 190_000) };
      } else if (/\.(txt|eml)$/.test(name)) {
        payload = { fileName: file.name, mime: "text/plain", base64: null, text: new TextDecoder().decode(buf).slice(0, 190_000) };
      } else {
        const mime = file.type || (name.endsWith(".pdf") ? "application/pdf" : "");
        payload = { fileName: file.name, mime, base64: toB64(buf), text: null };
      }
      const { loads } = await extract({ data: payload });
      if (!loads.length) return toast.info("No load details were found in that document.");
      setFound(loads);
      setFoundIdx(0);
      apply(loads[0]!);
      toast.success(loads.length > 1 ? `Found ${loads.length} loads — review each before creating` : "Load details filled in — review and create");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read that document");
    } finally {
      setReading(false);
    }
  };

  const ensureCompany = async (kind: Kind, p: Party) => {
    if (p.id || !p.name.trim()) return p.id;
    const { data, error } = await supabase.from("companies")
      .insert({ kind, name: p.name.trim(), address: p.address || null, city: p.city || null, state: p.state ? p.state.toUpperCase().slice(0, 2) : null, zip: p.zip || null, phone: p.phone || null, contact_name: p.contact_name || null, created_by: user.id })
      .select("id").single();
    if (error) throw new Error(`Couldn't add ${kind}: ${error.message}`);
    return data.id;
  };

  const reset = () => { setHint(""); setF({ equipment: "Dry Van" }); setParties({ customer: EMPTY, shipper: EMPTY, consignee: EMPTY }); };

  const save = async () => {
    if (!f.origin_city || !f.origin_state || !f.dest_city || !f.dest_state) return toast.error("Origin and destination are required.");
    setSaving(true);
    try {
      const [customer_id, shipper_id, consignee_id] = await Promise.all([
        ensureCompany("customer", parties.customer), ensureCompany("shipper", parties.shipper), ensureCompany("consignee", parties.consignee),
      ]);
      const added = (["customer", "shipper", "consignee"] as Kind[]).filter((k) => !parties[k].id && parties[k].name.trim());
      const num = (k: string) => (f[k] ? Number(f[k]) : null);
      const row = {
        customer_id: customer_id ?? null, shipper_id: shipper_id ?? null, consignee_id: consignee_id ?? null,
        origin_city: f.origin_city, origin_state: f.origin_state.toUpperCase(),
        dest_city: f.dest_city, dest_state: f.dest_state.toUpperCase(),
        pickup_at: f.pickup_at ? new Date(f.pickup_at).toISOString() : null,
        delivery_at: f.delivery_at ? new Date(f.delivery_at).toISOString() : null,
        equipment: f.equipment ?? "Dry Van", commodity: f.commodity || null,
        weight_lbs: num("weight_lbs"), pieces: num("pieces"), miles: num("miles"),
        temperature: f.temperature || null,
        pickup_notes: f.pickup_notes || null, delivery_notes: f.delivery_notes || null,
        customer_rate: num("customer_rate") ?? 0, carrier_rate: num("carrier_rate") ?? 0,
        ship_ref: f.ship_ref || null, dest_ref: f.dest_ref || null,
      };
      if (editLoad) {
        const { error } = await supabase.from("loads").update(row).eq("id", editLoad.id);
        if (error) throw new Error(error.message);
        toast.success(added.length ? `Load updated · added new ${added.join(", ")} to the Directory` : "Load updated");
        qc.invalidateQueries({ queryKey: ["loads"] });
        qc.invalidateQueries({ queryKey: ["companies"] });
        onOpenChange(false);
        return;
      }
      const { data, error } = await supabase.from("loads").insert({ ...row, broker_id: user.id }).select("id").single();
      if (error) throw new Error(error.message);
      const extra = Math.max(1, Math.min(50, Number(f.copies) || 1)) - 1;
      if (extra > 0) {
        const step = (Number(f.copy_step) || 0) * 86_400_000;
        const { error: e2 } = await supabase.from("loads").insert(copyRows(row, Array.from({ length: extra }, (_, i) => (i + 1) * step), user.id));
        if (e2) toast.error(`First load created, but copies failed: ${e2.message}`);
      }
      toast.success(`${extra > 0 ? `${extra + 1} loads created` : "Load created"}${added.length ? ` · added new ${added.join(", ")} to the Directory` : ""}`);
      qc.invalidateQueries({ queryKey: ["loads"] });
      qc.invalidateQueries({ queryKey: ["companies"] });
      onCreated(data.id);
      // Multi-load documents: move on to the next extracted load.
      const next = foundIdx + 1;
      if (next < found.length) { setFoundIdx(next); apply(found[next]!); return; }
      setFound([]);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create load");
    } finally {
      setSaving(false);
    }
  };

  const combo = (kind: Kind) => (
    <EntityCombobox
      value={parties[kind]}
      newLabel={`new ${kind}`}
      placeholder={`Type ${kind} name`}
      options={companies.filter((c) => c.kind === kind).map((c) => ({ id: c.id, label: c.name, sub: [c.city, c.state].filter(Boolean).join(", ") }))}
      onChange={(v) => {
        setParties((p) => ({ ...p, [kind]: { ...p[kind], ...v } }));
        const c = v.id ? companies.find((x) => x.id === v.id) : null;
        if (c && kind === "shipper") setF((p) => ({ ...p, origin_city: c.city ?? p.origin_city ?? "", origin_state: c.state ?? p.origin_state ?? "" }));
        if (c && kind === "consignee") setF((p) => ({ ...p, dest_city: c.city ?? p.dest_city ?? "", dest_state: c.state ?? p.dest_state ?? "" }));
      }}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl uppercase">{editLoad ? `Edit load ${editLoad.load_number}` : "Load builder"}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-center gap-3 rounded border border-dashed border-gold/50 bg-gold/5 p-3">
          <Button variant="secondary" disabled={reading} asChild>
            <label className="cursor-pointer">
              {reading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />}
              {reading ? "Reading document…" : "Import from document"}
              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.txt" disabled={reading}
                onChange={(e) => { readDoc(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </Button>
          <span className="text-xs text-muted-foreground">Rate con, tender, BOL, load sheet — PDF, photo, Excel or CSV. Fields fill in for you to review.</span>
          {found.length > 1 && (
            <div className="flex w-full flex-wrap gap-1">
              {found.map((x, i) => (
                <button key={i} onClick={() => { setFoundIdx(i); apply(x); }}
                  className={cn("rounded border px-2 py-0.5 text-xs", i === foundIdx ? "border-gold text-gold" : "text-muted-foreground")}>
                  Load {i + 1}: {x.origin_city ?? "?"} → {x.dest_city ?? "?"}
                </button>
              ))}
            </div>
          )}
          {hint && <div className="w-full rounded bg-muted p-2 text-xs">{hint}</div>}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <L label="Customer (bill-to)">{combo("customer")}</L>
          <L label="Shipper">{combo("shipper")}</L>
          <L label="Consignee">{combo("consignee")}</L>
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
          <L label="Pickup appointment"><DatePicker withTime value={f.pickup_at ?? ""} onChange={(v) => setF((p) => ({ ...p, pickup_at: v }))} /></L>
          <L label="Delivery appointment"><DatePicker withTime value={f.delivery_at ?? ""} onChange={(v) => setF((p) => ({ ...p, delivery_at: v }))} /></L>
          <L label="Temperature"><Input placeholder="e.g. 34°F" value={f.temperature ?? ""} onChange={set("temperature")} /></L>
          <L label="Commodity"><Input value={f.commodity ?? ""} onChange={set("commodity")} /></L>
          <L label="Weight (lbs)"><Input type="number" value={f.weight_lbs ?? ""} onChange={set("weight_lbs")} /></L>
          <L label="Pieces"><Input type="number" value={f.pieces ?? ""} onChange={set("pieces")} /></L>
          <L label="Customer rate ($)"><Input type="number" value={f.customer_rate ?? ""} onChange={set("customer_rate")} /></L>
          <L label="Target carrier pay ($)"><Input type="number" value={f.carrier_rate ?? ""} onChange={set("carrier_rate")} /></L>
          <L label="Shipper ref / BOL #"><Input value={f.ship_ref ?? ""} onChange={set("ship_ref")} /></L>
          <L label="Delivery ref / appt #"><Input value={f.dest_ref ?? ""} onChange={set("dest_ref")} /></L>
          {!editLoad && <L label="Create how many (1–50)"><Input type="number" min={1} max={50} placeholder="1" value={f.copies ?? ""} onChange={set("copies")} /></L>}
          {!editLoad && Number(f.copies) > 1 && <L label="Days between pickups (0 = same day, 7 = weekly)"><Input type="number" min={0} placeholder="1" value={f.copy_step ?? "1"} onChange={set("copy_step")} /></L>}
          <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-3">
            <L label="Pickup facility notes"><Textarea value={f.pickup_notes ?? ""} onChange={set("pickup_notes")} /></L>
            <L label="Delivery facility notes"><Textarea value={f.delivery_notes ?? ""} onChange={set("delivery_notes")} /></L>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editLoad ? "Save changes" : found.length > 1 ? `Create load ${foundIdx + 1} of ${found.length}` : "Create load"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
