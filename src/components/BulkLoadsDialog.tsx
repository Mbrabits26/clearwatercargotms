import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CopyPlus, FileUp, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EntityCombobox, type ComboValue } from "@/components/EntityCombobox";
import { EQUIPMENT, type Company } from "@/lib/tms";
import { extractLoadFromDoc } from "@/lib/extract.functions";
import type { Extracted } from "@/lib/extract.server";

type Kind = "customer" | "shipper" | "consignee";
type Row = {
  customer: string; shipper: string; origin_city: string; origin_state: string;
  consignee: string; dest_city: string; dest_state: string; pickup: string; delivery: string;
  equipment: string; commodity: string; weight: string; customer_rate: string; carrier_rate: string;
  ship_ref: string; dest_ref: string; copies: string;
};
const blank = (): Row => ({
  customer: "", shipper: "", origin_city: "", origin_state: "", consignee: "", dest_city: "", dest_state: "",
  pickup: "", delivery: "", equipment: "Dry Van", commodity: "", weight: "", customer_rate: "", carrier_rate: "",
  ship_ref: "", dest_ref: "", copies: "1",
});
const toB64 = (buf: ArrayBuffer) => {
  let s = ""; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const s = (v: unknown) => (v == null ? "" : String(v));
const fromExtracted = (x: Extracted): Row => ({
  ...blank(),
  customer: s(x.customer_name), shipper: s(x.shipper_name), origin_city: s(x.origin_city), origin_state: s(x.origin_state).toUpperCase(),
  consignee: s(x.consignee_name), dest_city: s(x.dest_city), dest_state: s(x.dest_state).toUpperCase(),
  pickup: s(x.pickup_at).slice(0, 10), delivery: s(x.delivery_at).slice(0, 10),
  equipment: EQUIPMENT.find((e) => x.equipment && e.toLowerCase() === x.equipment.toLowerCase()) ?? "Dry Van",
  commodity: s(x.commodity), weight: s(x.weight_lbs), customer_rate: s(x.customer_rate), carrier_rate: s(x.carrier_rate),
  ship_ref: s(x.ship_ref ?? x.po_number), dest_ref: s(x.dest_ref),
});
const COLS: { k: keyof Row; label: string; w: string; type?: string }[] = [
  { k: "shipper", label: "Shipper", w: "w-36" }, { k: "origin_city", label: "Origin city", w: "w-28" }, { k: "origin_state", label: "St", w: "w-12" },
  { k: "consignee", label: "Consignee", w: "w-36" }, { k: "dest_city", label: "Dest city", w: "w-28" }, { k: "dest_state", label: "St", w: "w-12" },
  { k: "pickup", label: "Pickup", w: "w-36", type: "date" }, { k: "delivery", label: "Delivery", w: "w-36", type: "date" },
  { k: "commodity", label: "Commodity", w: "w-28" }, { k: "weight", label: "Lbs", w: "w-20" },
  { k: "customer_rate", label: "Cust $", w: "w-20" }, { k: "carrier_rate", label: "Carr $", w: "w-20" },
  { k: "ship_ref", label: "PU ref", w: "w-24" }, { k: "dest_ref", label: "Del ref", w: "w-24" }, { k: "copies", label: "Copies", w: "w-16" },
];

export function BulkLoadsDialog({ open, onOpenChange, companies }: { open: boolean; onOpenChange: (o: boolean) => void; companies: Company[] }) {
  const qc = useQueryClient();
  const { user } = useRouteContext({ from: "/_authenticated" });
  const extract = useServerFn(extractLoadFromDoc);
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [mode, setMode] = useState<"one" | "each">("one");
  const [cust, setCust] = useState<ComboValue>({ id: null, name: "" });
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  const upd = (i: number, k: keyof Row, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const total = rows.reduce((n, r) => n + Math.max(1, Math.min(50, Number(r.copies) || 1)), 0);

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
        payload = { fileName: file.name, mime: file.type || (name.endsWith(".pdf") ? "application/pdf" : ""), base64: toB64(buf), text: null };
      }
      const { loads } = await extract({ data: payload });
      if (!loads.length) return toast.info("No loads were found in that file.");
      const got = loads.map(fromExtracted);
      setRows((r) => [...r.filter((x) => x.origin_city || x.dest_city), ...got]);
      const names = [...new Set(got.map((g) => g.customer).filter(Boolean))];
      if (names.length > 1) setMode("each");
      else if (names.length === 1 && !cust.name) {
        const c = companies.find((x) => x.kind === "customer" && x.name.toLowerCase() === names[0]!.toLowerCase());
        setCust(c ? { id: c.id, name: c.name } : { id: null, name: names[0]! });
      }
      toast.success(`Found ${got.length} load${got.length > 1 ? "s" : ""} — review the rows, then create`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read that file");
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    const list = rows.filter((r) => r.origin_city || r.dest_city || r.shipper || r.consignee);
    if (!list.length) return toast.error("Add at least one load.");
    const bad = list.findIndex((r) => !r.origin_city || !r.origin_state || !r.dest_city || !r.dest_state);
    if (bad >= 0) return toast.error(`Row ${bad + 1}: origin and destination city/state are required.`);
    if (mode === "one" && !cust.name.trim()) return toast.error("Pick the customer for these loads.");
    setSaving(true);
    try {
      const cache = new Map<string, string>();
      const resolve = async (kind: Kind, name: string, city?: string, state?: string) => {
        const n = name.trim();
        if (!n) return null;
        const key = `${kind}:${n.toLowerCase()}`;
        if (cache.has(key)) return cache.get(key)!;
        const hit = companies.find((c) => c.kind === kind && c.name.toLowerCase() === n.toLowerCase());
        let id = hit?.id;
        if (!id) {
          const { data, error } = await supabase.from("companies")
            .insert({ kind, name: n, city: city || null, state: state ? state.toUpperCase().slice(0, 2) : null, created_by: user.id })
            .select("id").single();
          if (error) throw new Error(`Couldn't add ${kind} ${n}: ${error.message}`);
          id = data.id;
        }
        cache.set(key, id);
        return id;
      };
      const oneId = mode === "one" ? cust.id ?? (await resolve("customer", cust.name)) : null;
      const inserts: Record<string, any>[] = [];
      for (const r of list) {
        const customer_id = mode === "one" ? oneId : await resolve("customer", r.customer);
        const shipper_id = await resolve("shipper", r.shipper, r.origin_city, r.origin_state);
        const consignee_id = await resolve("consignee", r.consignee, r.dest_city, r.dest_state);
        const n = Math.max(1, Math.min(50, Number(r.copies) || 1));
        for (let i = 0; i < n; i++) inserts.push({
          customer_id, shipper_id, consignee_id, broker_id: user.id, status: "available",
          origin_city: r.origin_city.trim(), origin_state: r.origin_state.trim().toUpperCase().slice(0, 2),
          dest_city: r.dest_city.trim(), dest_state: r.dest_state.trim().toUpperCase().slice(0, 2),
          pickup_at: r.pickup ? new Date(`${r.pickup}T08:00`).toISOString() : null,
          delivery_at: r.delivery ? new Date(`${r.delivery}T08:00`).toISOString() : null,
          equipment: r.equipment || "Dry Van", commodity: r.commodity || null,
          weight_lbs: r.weight ? Math.round(Number(r.weight.replace(/[^0-9.]/g, ""))) || null : null,
          customer_rate: Number(r.customer_rate.replace(/[^0-9.]/g, "")) || 0,
          carrier_rate: Number(r.carrier_rate.replace(/[^0-9.]/g, "")) || 0,
          ship_ref: r.ship_ref || null, dest_ref: r.dest_ref || null, accessorials: [],
        });
      }
      const { data, error } = await supabase.from("loads").insert(inserts as any).select("load_number");
      if (error) throw new Error(error.message);
      const nums = (data ?? []).map((d) => d.load_number);
      toast.success(`Created ${nums.length} loads${nums.length ? `: ${nums[0]}${nums.length > 1 ? ` to ${nums[nums.length - 1]}` : ""}` : ""}`);
      qc.invalidateQueries({ queryKey: ["loads"] });
      qc.invalidateQueries({ queryKey: ["companies"] });
      setRows([blank()]); setCust({ id: null, name: "" }); setMode("one");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the loads");
    } finally {
      setSaving(false);
    }
  };

  const custOpts = companies.filter((c) => c.kind === "customer").map((c) => ({ id: c.id, label: c.name, sub: [c.city, c.state].filter(Boolean).join(", ") }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[95vw] overflow-auto">
        <DialogHeader><DialogTitle>Bulk loads</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">Customer
            <Select value={mode} onValueChange={(v) => setMode(v as "one" | "each")}>
              <SelectTrigger className="mt-1 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="one">Same customer for all loads</SelectItem>
                <SelectItem value="each">Customer on each row</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {mode === "one" && (
            <div className="w-72 text-xs text-muted-foreground">Customer for every load
              <div className="mt-1"><EntityCombobox value={cust} onChange={setCust} options={custOpts} placeholder="Type or pick customer" newLabel="new customer" /></div>
            </div>
          )}
          <Button variant="outline" asChild disabled={reading}>
            <label className="cursor-pointer">
              {reading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileUp className="mr-1 h-4 w-4" />}
              {reading ? "Reading…" : "Upload load sheet"}
              <input type="file" className="hidden" accept=".pdf,.xlsx,.xls,.csv,.txt,.eml,image/*" onChange={(e) => { readDoc(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </Button>
          <Button variant="outline" onClick={() => setRows((r) => [...r, blank()])}><Plus className="mr-1 h-4 w-4" />Add row</Button>
        </div>
        <p className="text-xs text-muted-foreground">Upload a spreadsheet, PDF or tender with several loads, or type rows. Use "Copies" or the copy button for repeat loads on the same lane. New shippers/consignees/customers are added to the directory.</p>
        <div className="overflow-x-auto rounded border">
          <table className="text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-1">#</th>
                {mode === "each" && <th className="p-1">Customer</th>}
                {COLS.slice(0, 8).map((c) => <th key={c.k + c.label} className="p-1 font-medium">{c.label}</th>)}
                <th className="p-1">Equipment</th>
                {COLS.slice(8).map((c) => <th key={c.k} className="p-1 font-medium">{c.label}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1 text-muted-foreground">{i + 1}</td>
                  {mode === "each" && <td className="p-1"><Input list="bulk-customers" className="h-8 w-36 text-xs" value={r.customer} onChange={(e) => upd(i, "customer", e.target.value)} /></td>}
                  {COLS.slice(0, 8).map((c) => (
                    <td key={c.k} className="p-1"><Input list={c.k === "shipper" ? "bulk-shippers" : c.k === "consignee" ? "bulk-consignees" : undefined} type={c.type} className={`h-8 text-xs ${c.w}`} value={r[c.k]} onChange={(e) => upd(i, c.k, e.target.value)} /></td>
                  ))}
                  <td className="p-1">
                    <Select value={r.equipment} onValueChange={(v) => upd(i, "equipment", v)}>
                      <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{EQUIPMENT.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  {COLS.slice(8).map((c) => (
                    <td key={c.k} className="p-1"><Input className={`h-8 text-xs ${c.w}`} value={r[c.k]} onChange={(e) => upd(i, c.k, e.target.value)} /></td>
                  ))}
                  <td className="whitespace-nowrap p-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Duplicate row" onClick={() => setRows((x) => [...x.slice(0, i + 1), { ...r }, ...x.slice(i + 1)])}><CopyPlus className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" title="Remove row" onClick={() => setRows((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : [blank()]))}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="bulk-customers">{custOpts.map((o) => <option key={o.id} value={o.label} />)}</datalist>
          <datalist id="bulk-consignees">{companies.filter((c) => c.kind === "consignee").map((c) => <option key={c.id} value={c.name} />)}</datalist>
          <datalist id="bulk-shippers">{companies.filter((c) => c.kind === "shipper").map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">{total} load{total === 1 ? "" : "s"} will be created</span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Create {total} load{total === 1 ? "" : "s"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
