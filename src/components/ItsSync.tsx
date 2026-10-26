import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaged, loadsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ItsRow = {
  its: string;
  customer: string;
  dispatcher: string;
  carrier: string;
  origin: string;
  dest: string;
  ship: string | null;
  del: string | null;
  equip: string;
  weight: number | null;
  revenue: number | null;
  carrierPay: number | null;
  po: string;
  wo: string;
  mc: string;
};

type Profile = { id: string; full_name: string | null; email: string | null };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
};
const dt = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
};
const splitCity = (s: string): [string, string] => {
  const i = s.lastIndexOf(",");
  if (i < 0) return [s.trim(), ""];
  return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
};

// Header aliases, compared after normalizing (lowercase, punctuation → spaces).
// ITS exports come in several layouts (group reports and the flat "All Loads" export).
const COLS: Record<string, string[]> = {
  its: ["load", "load number", "load no", "its load", "its load number", "load id"],
  ship: ["ship date", "ship", "pickup date", "pick up date", "pu date", "pickup", "pick up", "ship dt", "pickup appt", "shipped"],
  del: ["del date", "delivery date", "deliver date", "del", "delivery", "drop date", "delivered", "delivery appt", "del dt"],
  origin: ["origin", "from", "pickup location", "origin location", "shipper location", "origin city state"],
  originCity: ["origin city", "shipper city", "pickup city", "pu city", "from city"],
  originState: ["origin state", "origin st", "shipper state", "shipper st", "pickup state", "pu state", "from state"],
  dest: ["destination", "dest", "to", "delivery location", "consignee location", "destination city state"],
  destCity: ["destination city", "dest city", "consignee city", "delivery city", "to city"],
  destState: ["destination state", "dest state", "destination st", "dest st", "consignee state", "consignee st", "delivery state", "to state"],
  po: ["po numbers", "po number", "po", "po s", "shipper po", "pu ref", "pickup ref", "pickup number", "bol", "bol number"],
  wo: ["w o", "w o number", "w o no", "wo", "wo number", "w0", "w0 number", "work order", "work order number", "customer ref", "customer ref number", "cust ref", "customer reference"],
  mc: ["carrier mc", "carrier mc number", "mc", "mc number", "carrier mc no"],
  equip: ["equipment type", "equipment", "equip", "trailer type", "trailer"],
  weight: ["weight", "weight lbs", "lbs", "total weight"],
  revenue: ["revenue", "customer rate", "total revenue", "rate", "customer total", "total charges", "charges", "billed", "bill amount", "invoice amount", "customer pay", "gross"],
  carrier: ["carrier name", "carrier"],
  carrierPay: ["carrier pay", "carrier rate", "carrier cost", "carrier total", "carrier amount", "cost", "pay", "truck pay"],
  customer: ["customer", "customer name", "bill to", "billto", "bill to name", "shipper customer"],
  dispatcher: ["dispatcher", "dispatcher name", "broker", "sales rep", "salesperson", "agent", "booked by"],
};
// Substring fallbacks when no exact header alias is found.
const FUZZY: Record<string, string[]> = {
  ship: ["ship", "pickup"], del: ["deliver"], revenue: ["revenue"], carrierPay: ["carrier pay", "carrier rate"],
  wo: ["w o", "work order"], equip: ["equip"], weight: ["weight"], mc: ["mc"],
};
const KEY_LABELS: Record<string, string> = { origin: "Origin", dest: "Destination", ship: "Pickup date", del: "Delivery date", customer: "Customer", revenue: "Revenue", carrierPay: "Carrier pay", carrier: "Carrier", wo: "W/O #" };
const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
const hnorm = (h: unknown) => String(h ?? "").toLowerCase().replace(/#/g, " number ").replace(/[^a-z0-9]+/g, " ").replace(/\bnumber\b\s*$/, "number").trim();
const aliasSet = (k: string) => new Set(COLS[k]!.map(hnorm));

export function resolveColumns(headerRow: unknown[]): Record<string, number> {
  const headers = headerRow.map(hnorm);
  const used = new Set<number>();
  const idx: Record<string, number> = {};
  // Exact matches first (more specific keys like originCity before origin).
  for (const k of Object.keys(COLS)) {
    const set = aliasSet(k);
    const i = headers.findIndex((h, j) => !used.has(j) && (set.has(h) || set.has(h.replace(/ number$/, ""))));
    idx[k] = i; if (i >= 0) used.add(i);
  }
  for (const [k, subs] of Object.entries(FUZZY)) {
    if (idx[k]! >= 0) continue;
    const i = headers.findIndex((h, j) => !used.has(j) && subs.some((s) => h.includes(s)));
    idx[k] = i; if (i >= 0) used.add(i);
  }
  return idx;
}

export type ParsedFile = { type: string; rows: ItsRow[]; missing: string[] };

async function parseFile(f: File): Promise<ParsedFile> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const title = String(grid[0]?.[0] ?? "");
  const type = title.includes("CUSTOMER") ? "customer" : title.includes("DISPATCHER") ? "dispatcher" : title.includes("CARRIER") ? "carrier" : "unknown";
  const loadAliases = aliasSet("its");
  const hi = grid.slice(0, 40).findIndex((r) => r.some((c) => { const h = hnorm(c); return loadAliases.has(h) || loadAliases.has(h.replace(/ number$/, "")); }));
  if (hi < 0) return { type, rows: [], missing: ["Load #"] };
  const idx = resolveColumns(grid[hi] ?? []);
  const has = (k: string) => idx[k]! >= 0;
  const missing = Object.entries(KEY_LABELS).filter(([k]) => {
    if (k === "origin") return !has("origin") && !has("originCity");
    if (k === "dest") return !has("dest") && !has("destCity");
    if (k === "customer") return !has("customer") && type !== "customer";
    if (k === "carrier") return !has("carrier") && type !== "carrier";
    return !has(k);
  }).map(([, l]) => l);
  const rows: ItsRow[] = [];
  let group = "";
  const cell = (r: unknown[], k: string): string => {
    const i = idx[k];
    if (i == null || i < 0) return "";
    const v = r[i];
    return v instanceof Date ? v.toISOString() : String(v ?? "").trim();
  };
  const raw = (r: unknown[], k: string): unknown => { const i = idx[k]; return i == null || i < 0 ? "" : r[i]; };
  const place = (r: unknown[], full: string, city: string, st: string) => {
    const c = cell(r, city), s2 = cell(r, st);
    if (c) return s2 ? `${c}, ${s2}` : c;
    return cell(r, full);
  };
  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i]!;
    const c0 = String(r[0] ?? "").trim();
    const loadNo = cell(r, "its").replace(/\.0+$/, "");
    if (!/^\d+$/.test(loadNo)) {
      // group header line (customer / dispatcher / carrier name) — skip city+tel line and totals
      if (c0 && !/tel:|total/i.test(c0) && !/^\d/.test(c0) && String(r[1] ?? "").trim() === "") group = c0;
      continue;
    }
    rows.push({
      its: loadNo,
      customer: cell(r, "customer") || (type === "customer" ? group : ""),
      dispatcher: cell(r, "dispatcher") || (type === "dispatcher" ? group : ""),
      carrier: cell(r, "carrier") || (type === "carrier" ? group : ""),
      origin: place(r, "origin", "originCity", "originState"),
      dest: place(r, "dest", "destCity", "destState"),
      ship: dt(raw(r, "ship")),
      del: dt(raw(r, "del")),
      equip: cell(r, "equip"),
      weight: num(raw(r, "weight")),
      revenue: num(raw(r, "revenue")),
      carrierPay: num(raw(r, "carrierPay")),
      po: cell(r, "po"),
      wo: cell(r, "wo"),
      mc: cell(r, "mc"),
    });
  }
  return { type, rows, missing };
}

export function ItsSync({ profiles }: { profiles: Profile[] }) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [merged, setMerged] = useState<Map<string, ItsRow> | null>(null);
  const [fallback, setFallback] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [missingCols, setMissingCols] = useState<string[]>([]);
  const [stats, setStats] = useState<{ total: number; existing: number; toUpdate: number; newCustomers: string[]; newCarriers: string[]; noBroker: string[] } | null>(null);
  const [match, setMatch] = useState<{ customers: Map<string, string>; carriers: Map<string, string>; mcs: Map<string, string>; existing: Set<string>; newCarrierMc: Map<string, string> } | null>(null);

  const { data: runs = [] } = useQuery({
    queryKey: ["its_sync_runs"],
    queryFn: async () => (await supabase.from("its_sync_runs").select("*").order("ran_at", { ascending: false }).limit(20)).data ?? [],
  });

  const readFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const fs = Array.from(list);
    setFiles(fs);
    setResult(null);
    setStats(null);
    setMatch(null);
    const map = new Map<string, ItsRow>();
    const missingAll: string[][] = [];
    try {
      for (const f of fs) {
        const { rows, missing } = await parseFile(f);
        missingAll.push(missing);
        for (const r of rows) {
          const cur = map.get(r.its) ?? { ...r };
          // cross-file merge: fill blanks only
          map.set(r.its, {
            ...cur,
            customer: cur.customer || r.customer,
            dispatcher: cur.dispatcher || r.dispatcher,
            carrier: cur.carrier || r.carrier,
            origin: cur.origin || r.origin,
            dest: cur.dest || r.dest,
            ship: cur.ship ?? r.ship,
            del: cur.del ?? r.del,
            equip: cur.equip || r.equip,
            weight: cur.weight ?? r.weight,
            revenue: cur.revenue ?? r.revenue,
            carrierPay: cur.carrierPay ?? r.carrierPay,
            po: cur.po || r.po,
            wo: cur.wo || r.wo,
            mc: cur.mc || r.mc,
          });
        }
      }
      // A column counts as missing only if no uploaded file has it.
      setMissingCols(missingAll.length ? missingAll.reduce((a, b) => a.filter((x) => b.includes(x))) : []);
      setMerged(map);
      if (!map.size) toast.error("No load rows found — are these ITS Dispatch reports?");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const woOf = (r: ItsRow) => r.wo || r.po;

  const check = async () => {
    if (!merged) return;
    setBusy(true);
    try {
      const loads = await fetchAllPaged("loads", "created_at", true);
      const byKey = new Map<string, Record<string, any>>();
      for (const l of loads) {
        if (l.external_ref) byKey.set(`x:${l.external_ref}`, l);
        byKey.set(`n:${l.load_number}`, l);
      }
      const companies = await fetchAllPaged("companies", "name", true);
      const carriers = await fetchAllPaged("carriers", "legal_name", true);
      const customers = new Map(companies.filter((c) => c.kind === "customer").map((c) => [norm(c.name as string), c.id as string]));
      const carrierMap = new Map(carriers.map((c) => [norm(c.legal_name as string), c.id as string]));
      const mcMap = new Map(carriers.filter((c) => c.mc_number && digits(String(c.mc_number))).map((c) => [digits(String(c.mc_number)), c.id as string]));
      const newCustomers = new Set<string>();
      const newCarriers = new Map<string, string>();
      const noBroker = new Set<string>();
      const existing = new Set<string>();
      let toUpdate = 0;
      for (const r of merged.values()) {
        const hit = byKey.get(`x:${r.its}`) ?? byKey.get(`n:CW-${r.its}`);
        if (hit) {
          existing.add(r.its);
          const wo = woOf(r);
          if ((wo && hit.customer_ref !== wo) || (!hit.ship_ref && r.po) || (!Number(hit.customer_rate) && r.revenue != null) || (!Number(hit.carrier_rate) && r.carrierPay != null)) toUpdate++;
          continue;
        }
        if (r.customer && !customers.has(norm(r.customer))) newCustomers.add(r.customer);
        const assigned = r.carrier && !/unassigned/i.test(r.carrier);
        if (assigned && !(r.mc && mcMap.has(digits(r.mc))) && !carrierMap.has(norm(r.carrier))) newCarriers.set(norm(r.carrier), r.mc);
        if (r.dispatcher && !profiles.some((p) => norm(p.full_name ?? "") === norm(r.dispatcher))) noBroker.add(r.dispatcher);
      }
      setMatch({ customers, carriers: carrierMap, mcs: mcMap, existing, newCarrierMc: newCarriers });
      const names = new Map<string, string>();
      for (const r of merged.values()) if (newCarriers.has(norm(r.carrier))) names.set(norm(r.carrier), r.carrier);
      setStats({ total: merged.size, existing: existing.size, toUpdate, newCustomers: [...newCustomers], newCarriers: [...names.values()], noBroker: [...noBroker] });
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  const sync = async () => {
    if (!merged || !match || !stats) return;
    if (!fallback) { toast.error("Pick who gets loads from dispatchers without a TMS login"); return; }
    setBusy(true);
    try {
      const custIds = new Map(match.customers);
      for (const name of stats.newCustomers) {
        const { data, error } = await supabase.from("companies").insert({ kind: "customer", name }).select("id").single();
        if (error) throw error;
        custIds.set(norm(name), data.id);
      }
      const carrIds = new Map(match.carriers);
      for (const name of stats.newCarriers) {
        const mc = match.newCarrierMc.get(norm(name)) || null;
        const { data, error } = await supabase.from("carriers").insert({ legal_name: name, status: "pending", mc_number: mc }).select("id").single();
        if (error) throw error;
        carrIds.set(norm(name), data.id);
      }
      const carrierFor = (r: ItsRow) => {
        if (!r.carrier || /unassigned/i.test(r.carrier)) return "";
        return (r.mc && match.mcs.get(digits(r.mc))) || carrIds.get(norm(r.carrier)) || "";
      };
      const brokerByName = new Map(profiles.map((p) => [norm(p.full_name ?? ""), p.id]));
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const rows = [...merged.values()].map((r) => {
        const [oc, os] = splitCity(r.origin);
        const [dc, ds] = splitCity(r.dest);
        const delivered = r.del ? new Date(r.del) < today : false;
        return {
          load_number: `CW-${r.its}`,
          external_ref: r.its,
          customer_id: (r.customer && custIds.get(norm(r.customer))) || "",
          carrier_id: carrierFor(r),
          broker_id: (r.dispatcher && brokerByName.get(norm(r.dispatcher))) || fallback,
          origin_city: oc, origin_state: os, dest_city: dc, dest_state: ds,
          pickup_at: r.ship ?? "", delivery_at: r.del ?? "",
          equipment: r.equip, weight_lbs: r.weight != null ? String(Math.round(r.weight)) : "",
          customer_rate: r.revenue != null ? String(r.revenue) : "",
          carrier_rate: r.carrierPay != null ? String(r.carrierPay) : "",
          status: delivered ? "delivered" : "booked",
          ship_ref: r.po,
          customer_ref: woOf(r),
        };
      });
      let inserted = 0, skipped = 0, updated = 0, failed = 0;
      const errors: { load: string; error: string }[] = [];
      for (let i = 0; i < rows.length; i += 200) {
        const { data, error } = await supabase.rpc("import_its_loads", { rows: rows.slice(i, i + 200) });
        if (error) throw error;
        const d = data as { inserted: number; skipped: number; updated?: number; failed?: number; errors?: { load: string; error: string }[] };
        inserted += d.inserted; skipped += d.skipped; updated += d.updated ?? 0; failed += d.failed ?? 0;
        errors.push(...(d.errors ?? []));
      }
      await supabase.from("its_sync_runs").insert({
        files: files.map((f) => f.name),
        loads_added: inserted, loads_skipped: skipped + updated,
        customers_added: stats.newCustomers.length, carriers_added: stats.newCarriers.length,
      });
      const errText = errors.length ? ` Problems: ${errors.slice(0, 5).map((e) => `${e.load} (${e.error})`).join("; ")}${errors.length > 5 ? "…" : ""}` : "";
      setResult(`Done — ${updated} existing loads updated with W/O # / rates, ${inserted} new loads added, ${skipped} already up to date${failed ? `, ${failed} could not be saved` : ""}. ${stats.newCustomers.length} new customers, ${stats.newCarriers.length} new carriers (pending vetting).${errText}`);
      setMerged(null); setStats(null); setMatch(null); setFiles([]);
      qc.invalidateQueries({ queryKey: loadsQuery.queryKey });
      qc.invalidateQueries({ queryKey: ["its_sync_runs"] });
      toast.success("ITS sync complete");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="rounded border bg-card">
      <h2 className="border-b p-3 font-display text-xl uppercase">ITS Dispatch sync</h2>
      <div className="space-y-3 p-3">
        <p className="text-xs text-muted-foreground">
          Drop in your ITS Dispatch reports (Customer, Dispatcher and/or External Carrier — Excel or CSV, one or several at a time). Loads already in the TMS are matched by ITS load # and get their W/O # saved as the Customer ref # (plus missing rates/carrier), so you can run this as often as you like. Carriers match by MC # first. New loads get their ITS number with CW in front; new carriers come in as pending until vetted.
        </p>
        <input type="file" multiple accept=".xlsx,.xls,.csv" className="text-sm" onChange={(e) => readFiles(e.target.files)} />
        {merged && (
          <div className="space-y-2 rounded border p-3">
            <div className="text-sm"><span className="text-gold">{merged.size}</span> loads found in {files.length} file{files.length > 1 ? "s" : ""}.</div>
            {!stats && <Button size="sm" variant="outline" disabled={busy} onClick={check}><RefreshCw className="mr-1 h-4 w-4" />Check against the TMS</Button>}
            {stats && (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>Already in TMS: <b>{stats.existing}</b> ({stats.toUpdate} to update)</div>
                  <div>New loads: <b className="text-gold">{stats.total - stats.existing}</b></div>
                  <div>New customers: <b>{stats.newCustomers.length}</b></div>
                  <div>New carriers: <b>{stats.newCarriers.length}</b></div>
                </div>
                {!!stats.noBroker.length && (
                  <div className="text-xs text-muted-foreground">
                    No TMS login for: {stats.noBroker.join(", ")} — their loads go to:
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Select value={fallback} onValueChange={setFallback}>
                    <SelectTrigger className="h-8 w-64"><SelectValue placeholder="Fallback broker for unmatched dispatchers" /></SelectTrigger>
                    <SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.email}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" disabled={busy} onClick={sync}><Upload className="mr-1 h-4 w-4" />Sync {stats.total - stats.existing} new + update {stats.toUpdate}</Button>
                </div>
              </>
            )}
          </div>
        )}
        {result && <div className="rounded border border-gold/40 bg-gold/10 p-3 text-sm">{result}</div>}
        {!!runs.length && (
          <div className="max-h-56 overflow-auto rounded border">
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Files</TableHead><TableHead>Loads added</TableHead><TableHead>Skipped</TableHead><TableHead>New customers</TableHead><TableHead>New carriers</TableHead></TableRow></TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.ran_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{(r.files as string[]).join(", ")}</TableCell>
                    <TableCell>{r.loads_added}</TableCell>
                    <TableCell>{r.loads_skipped}</TableCell>
                    <TableCell>{r.customers_added}</TableCell>
                    <TableCell>{r.carriers_added}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
