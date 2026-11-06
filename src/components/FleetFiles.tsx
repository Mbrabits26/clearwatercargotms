import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderOpen, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FLEET_CARRIER_ID } from "@/lib/tms";
import { DocLink } from "@/components/DocPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Driver Qualification (DQ) file items, per FMCSA Part 391. */
export const DRIVER_DOC_TYPES = [
  "Employment application", "CDL copy", "Medical card (DOT physical)", "MVR — pre-hire", "MVR — annual review",
  "Road test certificate", "Previous employer inquiries", "Pre-employment drug test", "Drug & alcohol clearinghouse query",
  "Random drug/alcohol test", "Annual certification of violations", "Other",
] as const;
export const UNIT_DOC_TYPES = ["Registration", "Annual DOT inspection", "Insurance", "IFTA", "Title", "Lease", "Maintenance / repair", "Other"] as const;
const REQUIRED_DQ = ["Employment application", "CDL copy", "Medical card (DOT physical)", "MVR — pre-hire", "Road test certificate", "Pre-employment drug test", "Drug & alcohol clearinghouse query"];

type Rec = { id: string; doc_type: string; file_path: string | null; file_name: string | null; expires_on: string | null; service_date: string | null; amount: number | null; odometer: number | null; notes: string | null; created_at: string };

const expState = (d: string | null) => {
  if (!d) return null;
  const days = (new Date(d + "T12:00:00").getTime() - Date.now()) / 86400_000;
  return days < 0 ? "expired" : days < 30 ? "soon" : null;
};

export function FleetFilesButton({ kind, id, label }: { kind: "driver" | "unit"; id: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><FolderOpen className="mr-1 h-3.5 w-3.5" />{kind === "driver" ? "DQ file" : "Files"}</Button>
      {open && <FleetFilesDialog kind={kind} id={id} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}

function FleetFilesDialog({ kind, id, label, onClose }: { kind: "driver" | "unit"; id: string; label: string; onClose: () => void }) {
  const qc = useQueryClient();
  const types = kind === "driver" ? DRIVER_DOC_TYPES : UNIT_DOC_TYPES;
  const { data: recs = [] } = useQuery({
    queryKey: ["fleet_records", id],
    queryFn: async () => ((await supabase.from("fleet_records").select("*").eq("owner_id", id).order("created_at", { ascending: false })).data ?? []) as Rec[],
  });
  const blank = { doc_type: types[0] as string, expires_on: "", service_date: "", amount: "", odometer: "", notes: "" };
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const maint = f.doc_type === "Maintenance / repair";

  const save = async () => {
    if (!file && !maint && !f.notes) return toast.error("Choose a file (or add a note).");
    setBusy(true);
    let file_path: string | null = null;
    if (file) {
      file_path = `${FLEET_CARRIER_ID}/fleet/${id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error } = await supabase.storage.from("carrier-docs").upload(file_path, file);
      if (error) { setBusy(false); return toast.error(error.message); }
    }
    const { error } = await supabase.from("fleet_records").insert({
      owner_kind: kind, owner_id: id, doc_type: f.doc_type, file_path, file_name: file?.name ?? null,
      expires_on: f.expires_on || null, service_date: f.service_date || null,
      amount: f.amount ? Number(f.amount) : null, odometer: f.odometer ? Number(f.odometer) : null, notes: f.notes || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setF(blank); setFile(null);
    qc.invalidateQueries({ queryKey: ["fleet_records", id] });
  };
  const remove = async (r: Rec) => {
    if (!confirm(`Delete "${r.doc_type}"?`)) return;
    const { error } = await supabase.from("fleet_records").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    if (r.file_path) await supabase.storage.from("carrier-docs").remove([r.file_path]);
    qc.invalidateQueries({ queryKey: ["fleet_records", id] });
  };

  const files = recs.filter((r) => r.doc_type !== "Maintenance / repair");
  const log = recs.filter((r) => r.doc_type === "Maintenance / repair");
  const missing = kind === "driver" ? REQUIRED_DQ.filter((t) => !recs.some((r) => r.doc_type === t)) : [];
  const items = files.filter((r) => r.file_path).map((r) => ({ name: r.file_name ?? r.doc_type, bucket: "carrier-docs" as const, path: r.file_path! }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{kind === "driver" ? "Driver qualification file" : "Unit files"} — {label}</DialogTitle></DialogHeader>
        {kind === "driver" && (
          <div className={missing.length ? "rounded border border-warning/50 bg-warning/10 p-2 text-sm text-warning" : "rounded border border-success/50 bg-success/10 p-2 text-sm text-success"}>
            {missing.length ? <>Missing from DQ file: {missing.join(", ")}</> : "All required DQ items are on file."}
          </div>
        )}
        <div className="grid gap-2 rounded border p-3 sm:grid-cols-3">
          <label className="text-xs sm:col-span-1">Type
            <select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.doc_type} onChange={(e) => setF({ ...f, doc_type: e.target.value })}>
              {types.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          {maint ? (
            <>
              <label className="text-xs">Service date<Input type="date" value={f.service_date} onChange={(e) => setF({ ...f, service_date: e.target.value })} /></label>
              <label className="text-xs">Cost ($)<Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
              <label className="text-xs">Odometer<Input type="number" value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value })} /></label>
            </>
          ) : (
            <label className="text-xs">Expires<Input type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} /></label>
          )}
          <label className="text-xs sm:col-span-2">Notes<Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={maint ? "e.g. PM service, brakes, tires" : ""} /></label>
          <label className="text-xs sm:col-span-2">File{maint ? " (optional receipt)" : ""}<Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <div className="flex items-end"><Button disabled={busy} onClick={save} className="w-full">{busy ? "Saving…" : "Add"}</Button></div>
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Files</div>
          {!files.length && <div className="text-sm text-muted-foreground">Nothing on file yet.</div>}
          {files.map((r) => {
            const s = expState(r.expires_on);
            const i = items.findIndex((x) => x.path === r.file_path);
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{r.doc_type}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.file_path ? <DocLink items={items} index={i} className="underline">{r.file_name}</DocLink> : "No file"}
                    {r.notes ? ` · ${r.notes}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.expires_on && <span className={s === "expired" ? "text-xs text-destructive" : s === "soon" ? "text-xs text-warning" : "text-xs text-muted-foreground"}>{s === "expired" ? "Expired" : "Exp"} {r.expires_on}</span>}
                  <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            );
          })}
        </div>
        {kind === "unit" && (
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Maintenance log {log.length ? `· total $${log.reduce((a, r) => a + Number(r.amount ?? 0), 0).toLocaleString()}` : ""}</div>
            {!log.length && <div className="text-sm text-muted-foreground">No service entries yet. Pick "Maintenance / repair" above to log one.</div>}
            {log.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
                <span>{r.service_date ?? "—"} · {r.notes ?? "Service"}{r.odometer ? ` · ${r.odometer.toLocaleString()} mi` : ""}</span>
                <span className="flex items-center gap-2">{r.amount != null && `$${Number(r.amount).toLocaleString()}`}<Button size="icon" variant="ghost" aria-label="Delete" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button></span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
