import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, Keyboard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractLoadFromDoc } from "@/lib/extract.functions";
import { BID_FIELDS, findHeaderRow, guessMapping, normEquipment, rowsToLanes, splitPlace, volumeToWeekly, type BidField } from "@/lib/bidDesk";
import type { Bid } from "@/lib/bids";
import { EQUIPMENT } from "@/lib/tms";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/DatePicker";

type Row = Record<string, unknown>;
type NewLane = Record<string, unknown>;

const jsonSafe = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v]));

/** Add lanes to a bid: a shipper RFP spreadsheet, a load tender / PDF, or typed in. */
export function BidImport({ bid, startPos, open, onOpenChange }: { bid: Bid; startPos: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const insert = async (lanes: NewLane[], headers?: string[], file?: string) => {
    if (!lanes.length) return toast.error("No lanes with both an origin and destination state were found.");
    setBusy(true);
    const rows = lanes.map((l, i) => ({ ...l, bid_id: bid.id, position: startPos + i }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("bid_lanes").insert(rows.slice(i, i + 500) as never);
      if (error) { setBusy(false); return toast.error(error.message); }
    }
    const hasHeaders = Array.isArray(bid.source_headers) && (bid.source_headers as unknown[]).length > 0;
    if (headers && !hasHeaders) await supabase.from("bids").update({ source_headers: headers, source_file: file ?? null }).eq("id", bid.id);
    setBusy(false);
    toast.success(`${lanes.length} lane${lanes.length === 1 ? "" : "s"} added`);
    qc.invalidateQueries({ queryKey: ["bid-lanes"] });
    qc.invalidateQueries({ queryKey: ["bids"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-auto">
        <DialogHeader><DialogTitle>Add lanes to {bid.bid_number}</DialogTitle></DialogHeader>
        <Tabs defaultValue="sheet">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="sheet"><FileSpreadsheet className="mr-1 h-4 w-4" />RFP spreadsheet</TabsTrigger>
            <TabsTrigger value="doc"><FileText className="mr-1 h-4 w-4" />Load tender / PDF</TabsTrigger>
            <TabsTrigger value="type"><Keyboard className="mr-1 h-4 w-4" />Type a lane</TabsTrigger>
          </TabsList>
          <TabsContent value="sheet"><SheetImport busy={busy} onImport={insert} /></TabsContent>
          <TabsContent value="doc"><DocImport busy={busy} setBusy={setBusy} onImport={(l) => insert(l)} /></TabsContent>
          <TabsContent value="type"><TypeLane busy={busy} onImport={(l) => insert(l)} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SheetImport({ busy, onImport }: { busy: boolean; onImport: (l: NewLane[], headers: string[], file: string) => void }) {
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [file, setFile] = useState("");
  const [sheet, setSheet] = useState("");
  const [map, setMap] = useState<Partial<Record<BidField, string>>>({});

  const parsed = useMemo(() => {
    if (!wb || !sheet) return null;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet]!, { header: 1, defval: "", raw: true });
    const hr = findHeaderRow(grid);
    const seen: Record<string, number> = {};
    const headers = (grid[hr] ?? []).map((h, i) => {
      let s = String(h ?? "").trim() || `Column ${i + 1}`;
      if (seen[s]) s = `${s} (${++seen[s]})`; else seen[s] = 1;
      return s;
    });
    const rows = grid.slice(hr + 1).filter((r) => r.some((c) => String(c ?? "").trim())).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
    return { headers, rows };
  }, [wb, sheet]);

  const pick = (w: XLSX.WorkBook, s: string) => {
    setSheet(s);
    const grid = XLSX.utils.sheet_to_json<unknown[]>(w.Sheets[s]!, { header: 1, defval: "" });
    const hr = findHeaderRow(grid);
    const g = guessMapping((grid[hr] ?? []).map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`));
    setMap(Object.fromEntries((Object.keys(BID_FIELDS) as BidField[]).filter((k) => g[k]).map((k) => [k, g[k]])));
  };

  const lanes = parsed ? rowsToLanes(parsed.rows, map) : [];
  return (
    <div className="space-y-3 pt-2 text-sm">
      <label className="inline-flex cursor-pointer items-center rounded border px-3 py-1.5 hover:bg-muted">
        <FileSpreadsheet className="mr-1 h-4 w-4" />{file || "Choose Excel or CSV file"}
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const w = XLSX.read(await f.arrayBuffer(), { cellDates: true });
          setWb(w); setFile(f.name); pick(w, w.SheetNames[0]!);
        }} />
      </label>
      {wb && wb.SheetNames.length > 1 && (
        <label className="ml-2 text-xs text-muted-foreground">Sheet{" "}
          <select className="h-8 rounded border bg-background px-2 text-sm" value={sheet} onChange={(e) => pick(wb, e.target.value)}>{wb.SheetNames.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
      )}
      {parsed && (
        <>
          <p className="text-xs text-muted-foreground">Check which column holds each detail. Use the combined “City, ST” choice when the sheet has one column per place. Your original columns are kept so the bid goes back in the shipper’s own layout.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(Object.keys(BID_FIELDS) as BidField[]).map((k) => (
              <label key={k} className="text-xs text-muted-foreground">{BID_FIELDS[k]}
                <select className="mt-0.5 h-8 w-full rounded border bg-background px-2 text-sm text-foreground" value={map[k] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value || undefined }))}>
                  <option value="">— not in sheet —</option>
                  {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="rounded border p-2 text-xs">
            <b>{lanes.length}</b> of {parsed.rows.length} rows read as lanes.
            {lanes.slice(0, 4).map((l, i) => <div key={i} className="text-muted-foreground">{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state} · {l.equipment}{l.miles ? ` · ${l.miles} mi` : ""}{l.volume ? ` · vol ${l.volume}` : ""}</div>)}
          </div>
          <Button disabled={busy || !lanes.length} onClick={() => onImport(lanes.map((l) => ({ ...l, original: jsonSafe(l.original) })), parsed.headers, file)}>
            {busy ? "Adding…" : `Add ${lanes.length} lanes`}
          </Button>
        </>
      )}
    </div>
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
      <p className="text-xs text-muted-foreground">Upload a load tender, rate request email saved as PDF, or a photo. The reader pulls each load’s origin, destination, equipment and pickup date.</p>
      <label className="inline-flex cursor-pointer items-center rounded border px-3 py-1.5 hover:bg-muted">
        <FileText className="mr-1 h-4 w-4" />{busy ? "Reading…" : "Choose PDF, image or spreadsheet"}
        <input type="file" accept=".pdf,image/*,.xlsx,.xls,.csv" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
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
  const blank = { origin: "", dest: "", equipment: "Dry Van", miles: "", volume: "", pickup_date: "" };
  const [f, setF] = useState(blank);
  const o = splitPlace(f.origin), d = splitPlace(f.dest);
  const ok = /^[A-Z]{2}$/.test(o.state) && /^[A-Z]{2}$/.test(d.state);
  return (
    <div className="space-y-2 pt-2 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input placeholder="Origin — City, ST (zip optional)" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} />
        <Input placeholder="Destination — City, ST (zip optional)" value={f.dest} onChange={(e) => setF({ ...f, dest: e.target.value })} />
        <select value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })} className="h-9 rounded border bg-background px-2">{EQUIPMENT.map((x) => <option key={x}>{x}</option>)}</select>
        <Input type="number" placeholder="Miles (blank = look up)" value={f.miles} onChange={(e) => setF({ ...f, miles: e.target.value })} />
        <Input placeholder="Volume, e.g. 3 per week or 150 per year" value={f.volume} onChange={(e) => setF({ ...f, volume: e.target.value })} />
        <DatePicker placeholder="Pickup date" value={f.pickup_date} onChange={(v) => setF({ ...f, pickup_date: v })} />
      </div>
      <Button disabled={busy || !ok} onClick={() => { onImport([{
        origin_city: o.city, origin_state: o.state, origin_zip: o.zip || null, dest_city: d.city, dest_state: d.state, dest_zip: d.zip || null,
        equipment: f.equipment, miles: Number(f.miles) || null, volume: f.volume || null, loads_per_week: f.volume ? volumeToWeekly(f.volume) : null, pickup_date: f.pickup_date || null,
      }]); setF(blank); }}>Add lane</Button>
      {!ok && (f.origin || f.dest) && <p className="text-xs text-warning">Write each place as City, ST — for example Staley, NC.</p>}
    </div>
  );
}
