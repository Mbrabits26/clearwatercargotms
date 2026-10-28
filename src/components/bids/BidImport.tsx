import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, Keyboard, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractLoadFromDoc } from "@/lib/extract.functions";
import {
  BID_FIELDS, OUT_FIELDS, defaultFieldMap, detectBelowPct, detectOrigin, findTables, normEquipment, rowsToLanes, sheetNotes, splitPlace, volumeToWeekly,
  type BidField, type FieldMap, type MapVal, type OutField, type SheetTable, type TableRows,
} from "@/lib/bidDesk";
import { bidTables, uploadBidFile, type Bid } from "@/lib/bids";
import { EQUIPMENT } from "@/lib/tms";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/DatePicker";
import { DropZone } from "@/components/DropZone";

type Row = Record<string, unknown>;
type NewLane = Record<string, unknown>;
type SheetPick = { t: TableRows; include: boolean; map: FieldMap };
type SheetResult = { picks: SheetPick[]; file: File; notes: string[]; belowPct: number | null };

const jsonSafe = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v]));
const EQUIP_LIST = "bid-equipment-list";

/** Add lanes to a bid: a shipper RFP spreadsheet, a load tender / PDF, or typed in. */
export function BidImport({ bid, startPos, open, onOpenChange }: { bid: Bid; startPos: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const insertRows = async (rows: NewLane[]) => {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("bid_lanes").insert(rows.slice(i, i + 500) as never);
      if (error) { toast.error(error.message); return false; }
    }
    return true;
  };
  const done = (n: number) => {
    toast.success(`${n} lane${n === 1 ? "" : "s"} added`);
    qc.invalidateQueries({ queryKey: ["bid-lanes"] });
    qc.invalidateQueries({ queryKey: ["bids"] });
    onOpenChange(false);
  };

  const insert = async (lanes: NewLane[]) => {
    if (!lanes.length) return toast.error("No lanes with an origin and destination were found.");
    setBusy(true);
    const ok = await insertRows(lanes.map((l, i) => ({ ...l, bid_id: bid.id, position: startPos + i })));
    setBusy(false);
    if (ok) done(lanes.length);
  };

  const insertSheet = async (r: SheetResult) => {
    const used = r.picks.filter((p) => p.include);
    const per = used.map((p) => ({ p, lanes: rowsToLanes(p.t.rows, p.map) }));
    const total = per.reduce((s, x) => s + x.lanes.length, 0);
    if (!total) return toast.error("No lanes were read. Check the origin and destination choices.");
    setBusy(true);
    const path = await uploadBidFile(bid.id, r.file);
    if (!path) toast.warning("The original file couldn't be saved, so the bid will go back as a clean Clearwater sheet.");
    const stamp = path ?? `${Date.now()}`;
    const tables: SheetTable[] = per.map(({ p }) => ({ ...p.t.table, key: `${stamp}|${p.t.table.key}`, path }));
    let pos = startPos;
    const rows = per.flatMap(({ lanes }, ti) => lanes.map((l) => ({ ...l, original: jsonSafe(l.original), source_table: tables[ti]!.key, bid_id: bid.id, position: pos++ })));
    const ok = await insertRows(rows);
    if (!ok) { setBusy(false); return; }
    const hasHeaders = Array.isArray(bid.source_headers) && (bid.source_headers as unknown[]).length > 0;
    const patch: Partial<Bid> = { source_tables: [...bidTables(bid), ...tables] as never };
    if (!hasHeaders) { patch.source_headers = tables[0]!.headers as never; patch.source_file = r.file.name; }
    if (path && !bid.source_path) patch.source_path = path;
    if (r.notes.length) patch.sheet_notes = [bid.sheet_notes, ...r.notes].filter(Boolean).join("\n\n");
    if (r.belowPct != null && bid.offer_below_pct == null) patch.offer_below_pct = r.belowPct;
    const { error } = await supabase.from("bids").update(patch).eq("id", bid.id);
    if (error) toast.error(error.message);
    setBusy(false);
    done(rows.length);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>Add lanes to {bid.bid_number}</DialogTitle></DialogHeader>
        <datalist id={EQUIP_LIST}>{EQUIPMENT.map((x) => <option key={x} value={x} />)}</datalist>
        <Tabs defaultValue="sheet">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="sheet"><FileSpreadsheet className="mr-1 h-4 w-4" />RFP spreadsheet</TabsTrigger>
            <TabsTrigger value="doc"><FileText className="mr-1 h-4 w-4" />Load tender / PDF</TabsTrigger>
            <TabsTrigger value="type"><Keyboard className="mr-1 h-4 w-4" />Type a lane</TabsTrigger>
          </TabsList>
          <TabsContent value="sheet"><SheetImport busy={busy} onImport={insertSheet} /></TabsContent>
          <TabsContent value="doc"><DocImport busy={busy} setBusy={setBusy} onImport={insert} /></TabsContent>
          <TabsContent value="type"><TypeLane busy={busy} onImport={insert} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SheetImport({ busy, onImport }: { busy: boolean; onImport: (r: SheetResult) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [picks, setPicks] = useState<SheetPick[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [origin, setOrigin] = useState<string | null>(null);
  const [below, setBelow] = useState("");

  const read = async (f: File) => {
    try {
      const w = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      // Read from A1 so row/column numbers match the real cells we write back into.
      const grids = w.SheetNames.map((s) => {
        const ws = w.Sheets[s]!;
        const ref = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
        const range = ref ? XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: ref.e }) : undefined;
        return { s, grid: XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true, blankrows: true, range }) };
      });
      const tables = grids.flatMap(({ s, grid }) => findTables(grid, s));
      const n = [...new Set(grids.flatMap(({ grid }) => sheetNotes(grid)))];
      const o = detectOrigin([...tables.flatMap((t) => t.table.headers), ...n]);
      const b = detectBelowPct(n);
      setFile(f); setNotes(n); setOrigin(o); setBelow(b == null ? "" : String(b));
      setPicks(tables.map((t) => { const map = defaultFieldMap(t.table.headers, o); return { t, map, include: rowsToLanes(t.rows, map).length > 0 }; }));
      if (!tables.length) toast.error("That file has no rows to read.");
    } catch (e) {
      toast.error(`Couldn't read that file: ${(e as Error).message}`);
    }
  };
  const update = (i: number, p: Partial<SheetPick>) => setPicks((all) => all.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const counts = picks.map((p) => rowsToLanes(p.t.rows, p.map).length);
  const total = picks.reduce((s, p, i) => s + (p.include ? counts[i]! : 0), 0);

  return (
    <div className="space-y-3 pt-2 text-sm">
      <DropZone accept=".xlsx,.xls,.csv" disabled={busy} onFile={read} compact={!!file}
        label={file ? <>Reading <b>{file.name}</b> — drop another file to replace it</> : "Drag the customer's RFP spreadsheet here, or click to choose it"}
        sub="Excel or CSV. Every sheet and every table on a sheet is read." />
      {file && (
        <>
          {(notes.length > 0 || origin) && (
            <div className="space-y-1 rounded border border-gold/40 bg-gold/5 p-2 text-xs">
              <div className="flex items-center gap-1 font-semibold text-gold"><Lightbulb className="h-3.5 w-3.5" />What the sheet tells us</div>
              {origin && <div>Lanes ship from <b>{origin}</b> (from a heading) — filled in as the origin where the sheet has no origin column.</div>}
              {notes.map((n, i) => <div key={i} className="text-muted-foreground">“{n}”</div>)}
              <label className="flex flex-wrap items-center gap-2 pt-1">
                Their opening offer is
                <Input className="h-7 w-16 text-xs" type="number" value={below} onChange={(e) => setBelow(e.target.value)} placeholder="0" />
                % below what they'll really pay. {below && Number(below) > 0 ? <span className="text-muted-foreground">Their likely budget = offer ÷ {(1 - Number(below) / 100).toFixed(2)}.</span> : <span className="text-muted-foreground">Leave blank if the sheet doesn't say.</span>}
              </label>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Pick which column holds each detail, or choose <b>Type it in</b> to use one value for every row (for example the origin, or the equipment). Your customer's file is kept so our counteroffers go back into their own cells.</p>
          {picks.map((p, i) => <TableCard key={p.t.table.key} pick={p} count={counts[i]!} onChange={(x) => update(i, x)} />)}
          <Button disabled={busy || !total} onClick={() => onImport({ picks, file, notes, belowPct: below.trim() === "" ? null : Number(below) })}>
            {busy ? "Adding…" : `Add ${total} lanes`}
          </Button>
        </>
      )}
    </div>
  );
}

function TableCard({ pick, count, onChange }: { pick: SheetPick; count: number; onChange: (p: Partial<SheetPick>) => void }) {
  const { table, rows } = pick.t;
  const lanes = useMemo(() => rowsToLanes(rows, pick.map), [rows, pick.map]);
  const setOut = (k: OutField, v: string) => onChange({ t: { ...pick.t, table: { ...table, out: { ...table.out, [k]: v || undefined } } } });
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <label className="flex items-center gap-2 font-medium">
        <Checkbox checked={pick.include} onCheckedChange={(v) => onChange({ include: v === true })} />
        {table.label}
        <span className="text-xs font-normal text-muted-foreground">{rows.length} rows · {count} read as lanes</span>
      </label>
      {pick.include && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {(Object.keys(BID_FIELDS) as BidField[]).map((k) => (
              <MapPicker key={k} label={BID_FIELDS[k]} headers={table.headers} value={pick.map[k]} list={k === "equipment" ? EQUIP_LIST : undefined}
                onChange={(v) => onChange({ map: { ...pick.map, [k]: v } })} />
            ))}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Where our numbers go back in this table</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {(["counter1", "counter2", "counter3", "final", "rpm", "all_in", "linehaul", "fsc_rpm"] as OutField[]).map((k) => (
                <label key={k} className="text-xs text-muted-foreground">{OUT_FIELDS[k]}
                  <select className="mt-0.5 h-8 w-full rounded border bg-background px-1 text-sm text-foreground" value={table.out[k] ?? ""} onChange={(e) => setOut(k, e.target.value)}>
                    <option value="">— leave out —</option>
                    {table.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
          <div className="rounded border bg-muted/20 p-2 text-xs">
            {lanes.length === 0 ? <span className="text-warning">No lanes yet — every lane needs an origin (City, ST) and a destination state or mileage band.</span> :
              lanes.slice(0, 4).map((l, i) => (
                <div key={i} className="text-muted-foreground">
                  {l.origin_city}, {l.origin_state} → {[l.dest_city, l.dest_state].filter(Boolean).join(", ") || `any stop ${l.mileage_band} mi`} · {l.equipment}
                  {l.miles ? ` · ${l.miles} mi` : ""}{l.offer_rpm ? ` · offer $${l.offer_rpm.toFixed(2)}/mi` : ""}{l.offer_flat ? ` · offer $${l.offer_flat}` : ""}{l.volume ? ` · vol ${l.volume}` : ""}
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Pick a sheet column, or type one value for every row. */
function MapPicker({ label, headers, value, onChange, list }: { label: string; headers: string[]; value: MapVal | undefined; onChange: (v: MapVal | undefined) => void; list?: string }) {
  const typed = value != null && typeof value === "object";
  return (
    <label className="text-xs text-muted-foreground">{label}
      <select className="mt-0.5 h-8 w-full rounded border bg-background px-2 text-sm text-foreground" value={typed ? "__type" : (value as string) ?? ""}
        onChange={(e) => onChange(e.target.value === "__type" ? { fixed: "" } : e.target.value || undefined)}>
        <option value="">— not in sheet —</option>
        <option value="__type">✎ Type it in…</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      {typed && <Input autoFocus list={list} className="mt-1 h-8 text-sm" placeholder="Same for every row" value={(value as { fixed: string }).fixed} onChange={(e) => onChange({ fixed: e.target.value })} />}
    </label>
  );
}

function DocImport({ busy, setBusy, onImport }: { busy: boolean; setBusy: (b: boolean) => void; onImport: (l: NewLane[]) => void }) {
  const read = useServerFn(extractLoadFromDoc);
  const [found, setFound] = useState<NewLane[]>([]);
  const onFile = async (f: File) => {
    setBusy(true);
    try {
      let text: string | null = null, base64: string | null = null;
      if (/\.(xlsx|xls|csv)$/i.test(f.name)) {
        const w = XLSX.read(await f.arrayBuffer());
        text = w.SheetNames.map((s) => XLSX.utils.sheet_to_csv(w.Sheets[s]!)).join("\n\n").slice(0, 190_000);
      } else {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        base64 = btoa(s);
      }
      const r = await read({ data: { fileName: f.name, mime: f.type || "application/pdf", base64, text } });
      const lanes = r.loads.map((x) => ({
        origin_city: x.origin_city ?? "", origin_state: (x.origin_state ?? "").toUpperCase().slice(0, 2), origin_zip: x.origin_zip,
        dest_city: x.dest_city ?? "", dest_state: (x.dest_state ?? "").toUpperCase().slice(0, 2), dest_zip: x.dest_zip,
        equipment: normEquipment(x.equipment), miles: x.miles, pickup_date: x.pickup_at ? x.pickup_at.slice(0, 10) : null,
        notes: [x.commodity, x.weight_lbs ? `${x.weight_lbs} lbs` : null, x.reference ? `Ref ${x.reference}` : null].filter(Boolean).join(" · ") || null,
      })).filter((l) => /^[A-Z]{2}$/.test(l.origin_state) && /^[A-Z]{2}$/.test(l.dest_state));
      setFound(lanes);
      if (!lanes.length) toast.error("No lanes could be read from that file.");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="space-y-3 pt-2 text-sm">
      <DropZone accept=".pdf,image/*,.xlsx,.xls,.csv" disabled={busy} onFile={onFile} icon={<FileText className="h-8 w-8 text-gold" />}
        label={busy ? "Reading…" : "Drag a load tender, rate request PDF or photo here, or click to choose"}
        sub="The reader pulls each load's origin, destination, equipment and pickup date." />
      {found.length > 0 && (
        <>
          <div className="rounded border p-2 text-xs">{found.map((l, i) => <div key={i}>{String(l.origin_city)}, {String(l.origin_state)} → {String(l.dest_city)}, {String(l.dest_state)} · {String(l.equipment)}{l.pickup_date ? ` · ${String(l.pickup_date)}` : ""}</div>)}</div>
          <Button disabled={busy} onClick={() => onImport(found)}>Add {found.length} lane{found.length === 1 ? "" : "s"}</Button>
        </>
      )}
    </div>
  );
}

function TypeLane({ busy, onImport }: { busy: boolean; onImport: (l: NewLane[]) => void }) {
  const blank = { origin: "", dest: "", equipment: "Dry Van", miles: "", volume: "", pickup_date: "", offer_rpm: "", offer_flat: "", carrier_cost: "", notes: "" };
  const [f, setF] = useState(blank);
  const o = splitPlace(f.origin), d = splitPlace(f.dest);
  const ok = /^[A-Z]{2}$/.test(o.state) && /^[A-Z]{2}$/.test(d.state);
  const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[$,]/g, "")) || null);
  return (
    <div className="space-y-2 pt-2 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">Origin<Input placeholder="City, ST (zip optional)" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">Destination<Input placeholder="City, ST — or just ST for a whole state" value={f.dest} onChange={(e) => setF({ ...f, dest: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">Equipment (pick or type)<Input list={EQUIP_LIST} value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">Miles<Input type="number" placeholder="Blank = look it up" value={f.miles} onChange={(e) => setF({ ...f, miles: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">Volume<Input placeholder="e.g. 3 per week or 150 per year" value={f.volume} onChange={(e) => setF({ ...f, volume: e.target.value })} /></label>
        <div className="text-xs text-muted-foreground">Pickup date<DatePicker placeholder="Pickup date" value={f.pickup_date} onChange={(v) => setF({ ...f, pickup_date: v })} /></div>
        <label className="text-xs text-muted-foreground">Shipper's offer $/mi<Input type="number" step="0.01" placeholder="e.g. 2.45" value={f.offer_rpm} onChange={(e) => setF({ ...f, offer_rpm: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">…or shipper's flat offer $<Input type="number" placeholder="e.g. 1250" value={f.offer_flat} onChange={(e) => setF({ ...f, offer_flat: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">Your carrier cost $ (all-in)<Input type="number" placeholder="Blank = use history / market" value={f.carrier_cost} onChange={(e) => setF({ ...f, carrier_cost: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">Notes<Input placeholder="Commodity, weight, special needs" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      </div>
      <Button disabled={busy || !ok} onClick={() => { onImport([{
        origin_city: o.city, origin_state: o.state, origin_zip: o.zip || null, dest_city: d.city, dest_state: d.state, dest_zip: d.zip || null,
        equipment: normEquipment(f.equipment), miles: n(f.miles), volume: f.volume || null, loads_per_week: f.volume ? volumeToWeekly(f.volume) : null, pickup_date: f.pickup_date || null,
        offer_rpm: n(f.offer_rpm), offer_flat: n(f.offer_flat), carrier_cost: n(f.carrier_cost), notes: f.notes.trim() || null,
      }]); setF(blank); }}>Add lane</Button>
      {!ok && (f.origin || f.dest) && <p className="text-xs text-warning">Write the origin as City, ST (for example Staley, NC) and the destination as City, ST or a state like GA.</p>}
    </div>
  );
}
