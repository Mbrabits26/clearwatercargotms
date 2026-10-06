import { useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Field = { key: string; label: string; aliases: string[]; required?: boolean };
const COMPANY_FIELDS: Field[] = [
  { key: "name", label: "Business name", aliases: ["name", "company", "business", "shipper name", "consignee name", "customer name", "customer"], required: true },
  { key: "address", label: "Street address", aliases: ["address", "street", "address 1"] },
  { key: "city", label: "City", aliases: ["city"] },
  { key: "state", label: "State", aliases: ["state", "st"] },
  { key: "zip", label: "ZIP", aliases: ["zip", "zip code", "postal"] },
  { key: "phone", label: "Phone", aliases: ["phone", "telephone", "tel"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail"] },
  { key: "contact_name", label: "Contact", aliases: ["contact", "contact name"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "comments"] },
];
const CARRIER_FIELDS: Field[] = [
  { key: "legal_name", label: "Legal name", aliases: ["legal name", "carrier", "carrier name", "name", "company"], required: true },
  { key: "dba", label: "DBA", aliases: ["dba"] },
  { key: "mc_number", label: "MC #", aliases: ["mc", "mc number", "mc #", "mc#"] },
  { key: "dot_number", label: "DOT #", aliases: ["dot", "dot number", "usdot", "dot #", "dot#"] },
  { key: "address", label: "Address", aliases: ["address", "street"] },
  { key: "city", label: "City", aliases: ["city"] },
  { key: "state", label: "State", aliases: ["state", "st"] },
  { key: "zip", label: "ZIP", aliases: ["zip", "zip code"] },
  { key: "phone", label: "Phone", aliases: ["phone", "telephone"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail"] },
  { key: "contact_name", label: "Contact", aliases: ["contact", "contact name"] },
  { key: "equipment", label: "Equipment", aliases: ["equipment", "trailer", "equipment type"] },
  { key: "insurance_expires", label: "Auto liability expires", aliases: ["insurance expires", "auto liability expires", "insurance expiration"] },
  { key: "cargo_expires", label: "Cargo expires", aliases: ["cargo expires", "cargo expiration"] },
];

const LINK = /https?:\/\/|www\.|\.(com|net|org|io)(\/|\b)/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

function guess(headers: string[], f: Field) {
  const hs = headers.map(norm);
  let i = hs.findIndex((h) => f.aliases.includes(h));
  if (i < 0) i = hs.findIndex((h) => f.aliases.some((a) => h.endsWith(" " + a) || h.startsWith(a + " ")));
  return i < 0 ? "" : headers[i]!;
}
function toDate(v: unknown) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function BulkImportButton({ target, onDone }: { target: "company" | "carrier"; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Upload className="mr-1 h-4 w-4" />Bulk import</Button>
      <BulkImportDialog open={open} onOpenChange={setOpen} target={target} onDone={onDone} />
    </>
  );
}

function BulkImportDialog({ open, onOpenChange, target, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; target: "company" | "carrier"; onDone: () => void }) {
  const fields = target === "company" ? COMPANY_FIELDS : CARRIER_FIELDS;
  const [kind, setKind] = useState("customer");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [file, setFile] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setRows([]); setHeaders([]); setMap({}); setFile(""); };
  const read = async (f?: File) => {
    if (!f) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
    // cells with hyperlinks are treated as links and ignored
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    const hdr = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0] ?? []).map(String);
    for (let r = range.s.r + 1; r <= range.e.r; r++)
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell?.l && data[r - 1] && hdr[c]) data[r - 1]![hdr[c]!] = "";
      }
    const h = Object.keys(data[0] ?? {});
    setHeaders(h);
    setRows(data);
    setFile(f.name);
    setMap(Object.fromEntries(fields.map((fl) => [fl.key, guess(h, fl)])));
  };

  const build = () => {
    const req = fields.find((f) => f.required)!;
    let links = 0;
    const out = rows.map((r) => {
      const o: Record<string, string | null> = {};
      for (const f of fields) {
        const col = map[f.key];
        let v = col ? String(r[col] ?? "").trim() : "";
        if (v && LINK.test(v)) { links++; v = ""; }
        if (f.key === "zip") v = v.replace(/\.0$/, "");
        if (f.key === "state") v = v.toUpperCase().slice(0, 2);
        o[f.key] = f.key.endsWith("expires") ? toDate(v) : v || null;
      }
      return o;
    }).filter((o) => o[req.key]);
    return { out, links };
  };
  const preview = rows.length ? build() : { out: [], links: 0 };

  const save = async () => {
    const { out } = build();
    if (!out.length) return toast.error("No rows with a name to import.");
    setBusy(true);
    const nameKey = target === "company" ? "name" : "legal_name";
    const existing = target === "company"
      ? (await supabase.from("companies").select("name").eq("kind", kind)).data?.map((x) => x.name.toLowerCase()) ?? []
      : (await supabase.from("carriers").select("legal_name").limit(5000)).data?.map((x) => x.legal_name.toLowerCase()) ?? [];
    const seen = new Set(existing);
    const fresh = out.filter((o) => { const k = String(o[nameKey]).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    let added = 0;
    for (let i = 0; i < fresh.length; i += 200) {
      const chunk = fresh.slice(i, i + 200);
      const { error } = target === "company"
        ? await supabase.from("companies").insert(chunk.map((c) => ({ ...c, kind, name: c.name! })))
        : await supabase.from("carriers").insert(chunk.map((c) => ({ ...c, legal_name: c.legal_name!, status: "pending" as const })));
      if (error) { setBusy(false); return toast.error(`Stopped after ${added} rows: ${error.message}`); }
      added += chunk.length;
    }
    setBusy(false);
    toast.success(`Imported ${added}${out.length - added ? ` · skipped ${out.length - added} already in the system` : ""}`);
    onDone();
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Bulk import {target === "company" ? "directory" : "carriers"}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Upload an Excel (.xlsx/.xls) or CSV file. The first row should be column headings. Cells containing links are ignored, and names already in the system are skipped.{target === "carrier" && " Carriers come in as pending until vetted."}</p>
        <div className="flex gap-2">
          {target === "company" && (
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{[["customer", "Customers"], ["shipper", "Shippers"], ["consignee", "Consignees"]].map(([v, l]) => <SelectItem key={v} value={v}>Import as {l}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <input type="file" accept=".xlsx,.xls,.csv" className="text-sm" onChange={(e) => read(e.target.files?.[0])} />
        </div>
        {headers.length > 0 && (
          <>
            <div className="text-xs text-muted-foreground">{file}: {rows.length} rows. Match your columns:</div>
            <div className="grid max-h-64 grid-cols-2 gap-2 overflow-auto">
              {fields.map((f) => (
                <label key={f.key} className="text-xs text-muted-foreground">{f.label}{f.required && " *"}
                  <Select value={map[f.key] || "__none"} onValueChange={(v) => setMap((m) => ({ ...m, [f.key]: v === "__none" ? "" : v }))}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="__none">— skip —</SelectItem>{headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
              ))}
            </div>
            <div className="rounded border bg-muted/40 p-2 text-xs">
              Ready: <b>{preview.out.length}</b> rows{preview.links > 0 && ` · ${preview.links} link cells ignored`}
              {preview.out[0] && <div className="mt-1 truncate text-muted-foreground">First: {Object.values(preview.out[0]).filter(Boolean).join(" · ")}</div>}
            </div>
            <div className="flex justify-end"><Button disabled={busy} onClick={save}>{busy ? "Importing…" : `Import ${preview.out.length} rows`}</Button></div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
