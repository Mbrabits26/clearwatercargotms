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

const COLS: Record<string, string[]> = {
  its: ["load #"],
  ship: ["ship/date"],
  del: ["del/date"],
  origin: ["origin"],
  dest: ["destination"],
  po: ["po numbers"],
  equip: ["equipment type"],
  weight: ["weight"],
  revenue: ["revenue"],
  carrier: ["carrier name"],
  carrierPay: ["carrier pay"],
};

async function parseFile(f: File): Promise<{ type: string; rows: ItsRow[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const title = String(grid[0]?.[0] ?? "");
  const type = title.includes("CUSTOMER") ? "customer" : title.includes("DISPATCHER") ? "dispatcher" : title.includes("CARRIER") ? "carrier" : "unknown";
  const hi = grid.findIndex((r) => String(r[0]).trim() === "Load #");
  if (hi < 0) return { type, rows: [] };
  const headers = (grid[hi] ?? []).map((h) => String(h).trim().toLowerCase());
  const col = (key: string) => headers.findIndex((h) => COLS[key]!.includes(h));
  const idx = Object.fromEntries(Object.keys(COLS).map((k) => [k, col(k)]));
  const rows: ItsRow[] = [];
  let group = "";
  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i]!;
    const c0 = String(r[0] ?? "").trim();
    if (!c0) continue;
    const loadNo = idx.its >= 0 ? String(r[idx.its] ?? "").trim() : "";
    if (!/^\d+$/.test(loadNo)) {
      // group header line (customer / dispatcher / carrier name) — skip city+tel line and totals
      if (!/tel:|total/i.test(c0) && !/^\d/.test(c0) && String(r[1] ?? "").trim() === "") group = c0;
      continue;
    }
    rows.push({
      its: loadNo,
      customer: type === "customer" ? group : "",
      dispatcher: type === "dispatcher" ? group : "",
      carrier: (idx.carrier >= 0 ? String(r[idx.carrier] ?? "").trim() : "") || (type === "carrier" ? group : ""),
      origin: idx.origin >= 0 ? String(r[idx.origin] ?? "").trim() : "",
      dest: idx.dest >= 0 ? String(r[idx.dest] ?? "").trim() : "",
      ship: idx.ship >= 0 ? dt(r[idx.ship]) : null,
      del: idx.del >= 0 ? dt(r[idx.del]) : null,
      equip: idx.equip >= 0 ? String(r[idx.equip] ?? "").trim() : "",
      weight: idx.weight >= 0 ? num(r[idx.weight]) : null,
      revenue: idx.revenue >= 0 ? num(r[idx.revenue]) : null,
      carrierPay: idx.carrierPay >= 0 ? num(r[idx.carrierPay]) : null,
      po: idx.po >= 0 ? String(r[idx.po] ?? "").trim() : "",
    });
  }
  return { type, rows };
}

export function ItsSync({ profiles }: { profiles: Profile[] }) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [merged, setMerged] = useState<Map<string, ItsRow> | null>(null);
  const [fallback, setFallback] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [stats, setStats] = useState<{ total: number; existing: number; newCustomers: string[]; newCarriers: string[]; noBroker: string[] } | null>(null);
  const [match, setMatch] = useState<{ customers: Map<string, string>; carriers: Map<string, string>; existing: Set<string> } | null>(null);

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
    try {
      for (const f of fs) {
        const { rows } = await parseFile(f);
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
          });
        }
      }
      setMerged(map);
      if (!map.size) toast.error("No load rows found — are these ITS Dispatch reports?");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const check = async () => {
    if (!merged) return;
    setBusy(true);
    try {
      const existing = new Set(
        ((await supabase.from("loads").select("external_ref").eq("source", "its")).data ?? []).map((l) => l.external_ref as string),
      );
      const companies = await fetchAllPaged("companies", "name");
      const carriers = await fetchAllPaged("carriers", "legal_name");
      const customers = new Map(companies.filter((c) => c.kind === "customer").map((c) => [norm(c.name as string), c.id as string]));
      const carrierMap = new Map(carriers.map((c) => [norm(c.legal_name as string), c.id as string]));
      const newCustomers = new Set<string>();
      const newCarriers = new Set<string>();
      const noBroker = new Set<string>();
      for (const r of merged.values()) {
        if (existing.has(r.its)) continue;
        if (r.customer && !customers.has(norm(r.customer))) newCustomers.add(r.customer);
        if (r.carrier && !/unassigned/i.test(r.carrier) && !carrierMap.has(norm(r.carrier))) newCarriers.add(r.carrier);
        if (r.dispatcher && !profiles.some((p) => norm(p.full_name ?? "") === norm(r.dispatcher))) noBroker.add(r.dispatcher);
      }
      setMatch({ customers, carriers: carrierMap, existing });
      setStats({ total: merged.size, existing: [...merged.keys()].filter((k) => existing.has(k)).length, newCustomers: [...newCustomers], newCarriers: [...newCarriers], noBroker: [...noBroker] });
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
      // create missing customers + carriers first
      const custIds = new Map(match.customers);
      for (const name of stats.newCustomers) {
        const { data, error } = await supabase.from("companies").insert({ kind: "customer", name }).select("id").single();
        if (error) throw error;
        custIds.set(norm(name), data.id);
      }
      const carrIds = new Map(match.carriers);
      for (const name of stats.newCarriers) {
        const { data, error } = await supabase.from("carriers").insert({ legal_name: name, status: "pending" }).select("id").single();
        if (error) throw error;
        carrIds.set(norm(name), data.id);
      }
      const brokerByName = new Map(profiles.map((p) => [norm(p.full_name ?? ""), p.id]));
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const rows = [...merged.values()]
        .filter((r) => !match.existing.has(r.its))
        .map((r) => {
          const [oc, os] = splitCity(r.origin);
          const [dc, ds] = splitCity(r.dest);
          const delivered = r.del ? new Date(r.del) < today : false;
          return {
            load_number: `CW-${r.its}`,
            external_ref: r.its,
            customer_id: (r.customer && custIds.get(norm(r.customer))) || "",
            carrier_id: (r.carrier && !/unassigned/i.test(r.carrier) && carrIds.get(norm(r.carrier))) || "",
            broker_id: (r.dispatcher && brokerByName.get(norm(r.dispatcher))) || fallback,
            origin_city: oc, origin_state: os, dest_city: dc, dest_state: ds,
            pickup_at: r.ship ?? "", delivery_at: r.del ?? "",
            equipment: r.equip, weight_lbs: r.weight != null ? String(Math.round(r.weight)) : "",
            customer_rate: r.revenue != null ? String(r.revenue) : "",
            carrier_rate: r.carrierPay != null ? String(r.carrierPay) : "",
            status: delivered ? "delivered" : "booked",
            ship_ref: r.po,
          };
        });
      let inserted = 0, skipped = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const { data, error } = await supabase.rpc("import_its_loads", { rows: rows.slice(i, i + 200) });
        if (error) throw error;
        inserted += (data as { inserted: number }).inserted;
        skipped += (data as { skipped: number }).skipped;
      }
      await supabase.from("its_sync_runs").insert({
        files: files.map((f) => f.name),
        loads_added: inserted, loads_skipped: skipped + stats.existing,
        customers_added: stats.newCustomers.length, carriers_added: stats.newCarriers.length,
      });
      setResult(`Done — ${inserted} loads added, ${skipped + stats.existing} already in the TMS, ${stats.newCustomers.length} new customers, ${stats.newCarriers.length} new carriers (pending vetting).`);
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
          Drop in your ITS Dispatch reports (Customer, Dispatcher and/or External Carrier — Excel or CSV, one or several at a time). Loads already in the TMS are skipped, so you can run this as often as you like. New loads get their ITS number with CW in front; new carriers come in as pending until vetted.
        </p>
        <input type="file" multiple accept=".xlsx,.xls,.csv" className="text-sm" onChange={(e) => readFiles(e.target.files)} />
        {merged && (
          <div className="space-y-2 rounded border p-3">
            <div className="text-sm"><span className="text-gold">{merged.size}</span> loads found in {files.length} file{files.length > 1 ? "s" : ""}.</div>
            {!stats && <Button size="sm" variant="outline" disabled={busy} onClick={check}><RefreshCw className="mr-1 h-4 w-4" />Check against the TMS</Button>}
            {stats && (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>Already in TMS: <b>{stats.existing}</b></div>
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
                  <Button size="sm" disabled={busy} onClick={sync}><Upload className="mr-1 h-4 w-4" />Sync {stats.total - stats.existing} loads</Button>
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
