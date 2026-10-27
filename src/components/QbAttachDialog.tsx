import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocLink, type DocItem } from "@/components/DocPreview";
import { RenameDoc, useLoadDocNames } from "@/components/RenameDoc";
import { isPodDoc, isSent, parseAttachments, qbContentType, type QbAttachment } from "@/lib/qbAttachments";
import { qbSyncNow } from "@/lib/quickbooks.functions";
import { ActionButton, Hint } from "@/components/ActionGuard";

export type AttachRow = { id: string; kind: string; load_id: string; invoice_number: string | null; qb_ref: string | null; attachments?: unknown; attachments_sent?: unknown; attach_on_send?: boolean };

/** Pick load documents (POD, BOL, rate con, lumper receipts…) to attach to the QuickBooks invoice or bill. */
export function QbAttachDialog({ row, loads, onClose, onSaved }: { row: AttachRow | null; loads: { id: string; load_number: string }[]; onClose: () => void; onSaved: () => void }) {
  const [picked, setPicked] = useState<QbAttachment[]>([]);
  const [onSend, setOnSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const sync = useServerFn(qbSyncNow);
  const ids = row ? [...new Set([row.load_id, ...loads.map((l) => l.id)])] : [];
  useEffect(() => { if (row) { setPicked(parseAttachments(row.attachments)); setOnSend(row.attach_on_send ?? true); } }, [row?.id]);

  const { data: raw = [], refetch } = useQuery({
    queryKey: ["qb-attach-files", ...ids],
    enabled: !!row,
    queryFn: async () => (await Promise.all(ids.map(async (id) => ((await supabase.storage.from("load-docs").list(id, { sortBy: { column: "created_at", order: "desc" } })).data ?? [])
      .filter((f) => f.id).map((f) => ({ name: f.name, path: `${id}/${f.name}`, load: loads.find((l) => l.id === id)?.load_number ?? "" }))))).flat(),
  });
  const { nameOf, rename } = useLoadDocNames(raw.map((f) => f.path));
  const files = raw.map((f) => ({ ...f, file: f.name, name: nameOf(f.path, f.name) }));
  const items: DocItem[] = files.map((f) => ({ name: f.name, bucket: "load-docs", path: f.path }));
  const renameFile = async (path: string, n: string) => {
    const err = await rename(path, n);
    if (!err) setPicked((x) => x.map((a) => (a.path === path ? { ...a, name: n } : a)));
    return err;
  };
  const has = (p: string) => picked.some((a) => a.path === p);
  // Unsent customer invoices pick up every POD on the load automatically when they go to QuickBooks.
  const autoPod = (f: { path: string; name: string }) => row?.kind !== "bill" && !row?.qb_ref && isPodDoc(f.path, f.name);
  const toggle = (f: { path: string; name: string }) => setPicked((x) => (has(f.path) ? x.filter((a) => a.path !== f.path) : [...x, { path: f.path, name: f.name }]));

  const upload = async (file?: File) => {
    if (!file || !row) return;
    if (!qbContentType(file.name)) return toast.error("QuickBooks only accepts PDF, JPG, PNG, GIF, TIFF, Word, Excel, CSV or text files.");
    const path = `${row.load_id}/file-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    setBusy(true);
    const { error } = await supabase.storage.from("load-docs").upload(path, file);
    setBusy(false);
    if (error) return toast.error(error.message);
    setPicked((x) => [...x, { path, name: path.split("/").pop()! }]);
    refetch();
  };

  const save = async () => {
    if (!row) return;
    setBusy(true);
    const { error } = await supabase.from("qb_sync").update({ attachments: picked, attach_on_send: onSend } as never).eq("id", row.id);
    if (error) { setBusy(false); return toast.error(error.message); }
    if (row.qb_ref) {
      try {
        const r = await sync({ data: { ids: [row.id] } });
        if (r.attachFailed) toast.warning(`${r.attached} file(s) attached in QuickBooks, ${r.attachFailed} failed — see the note under the status.`);
        else toast.success(r.attached ? `${r.attached} file(s) attached in QuickBooks.` : "Saved.");
      } catch (e) { toast.error((e as Error).message); }
    } else toast.success(`Saved — ${picked.length} file(s) will be attached when this goes to QuickBooks.`);
    setBusy(false);
    onSaved();
  };

  const label = row?.kind === "bill" ? "bill" : `invoice ${row?.invoice_number ?? ""}`;
  return (
    <Dialog open={!!row} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Attach documents to {label}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Tick the files to send to QuickBooks with this {row?.kind === "bill" ? "bill" : "invoice"}. Files already in QuickBooks stay there and aren't sent twice.{row?.kind !== "bill" && !row?.qb_ref ? " PODs on the load are attached automatically when the invoice is sent." : ""}</p>
        <ul className="max-h-72 divide-y overflow-auto rounded border text-sm">
          {files.map((f, i) => {
            const done = isSent(f.path, row?.attachments_sent);
            const auto = !done && autoPod(f);
            return (
              <li key={f.path} className="flex items-center gap-2 px-2 py-1.5">
                <input type="checkbox" checked={done || auto || has(f.path)} disabled={done || auto} onChange={() => toggle(f)} aria-label={`Attach ${f.name}`} />
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <DocLink items={items} index={i} className="min-w-0 flex-1 truncate">{f.name}</DocLink>
                <RenameDoc name={f.name} original={f.file} onSave={(n) => renameFile(f.path, n)} />
                {ids.length > 1 && <span className="font-mono text-[10px] text-gold">{f.load}</span>}
                {done && <span className="text-[10px] text-primary">In QuickBooks</span>}
                {auto && <Hint text="PODs already on the load are attached to the customer invoice automatically when it's sent to QuickBooks."><span className="text-[10px] text-primary">POD · auto</span></Hint>}
              </li>
            );
          })}
          {!files.length && <li className="p-3 text-xs text-muted-foreground">No documents on this load yet. Upload one below.</li>}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Hint text="Upload a new file to this load (PDF, image, Word, Excel…) and tick it to attach."><Button size="sm" variant="secondary" disabled={busy} asChild>
            <label className="cursor-pointer"><Upload className="mr-1 h-3.5 w-3.5" />Upload a file
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.gif,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </Button></Hint>
          <span className="text-xs text-muted-foreground">or drag &amp; drop a file here</span>
          {row?.kind !== "bill" && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={onSend} onChange={(e) => setOnSend(e.target.checked)} />
              Include files when QuickBooks emails the invoice
            </label>
          )}
        </div>
        <ActionButton className="w-full" hintClassName="flex w-full" disabled={busy}
          hint={row?.qb_ref ? "Saves your picks and uploads the new files to this QuickBooks entry right now." : "Saves your picks. The files go to QuickBooks when this is sent."}
          confirm={() => {
            const fresh = picked.filter((a) => !isSent(a.path, row?.attachments_sent)).length;
            return {
              title: row?.qb_ref ? `Attach ${fresh} file${fresh === 1 ? "" : "s"} in QuickBooks now?` : `Save ${picked.length} file${picked.length === 1 ? "" : "s"} to attach?`,
              points: [
                row?.qb_ref ? `Uploads ${fresh} new file${fresh === 1 ? "" : "s"} to ${label} in QuickBooks right away. Files already there aren't sent twice.` : `Nothing goes to QuickBooks yet — the files are attached when ${label.trim()} is sent.`,
                row?.kind !== "bill" ? (onSend ? "QuickBooks will include them if it emails the invoice." : "QuickBooks will not include them in its invoice emails.") : null,
                "The invoice amount and load are not changed.",
              ].filter(Boolean),
              confirmLabel: row?.qb_ref ? "Attach now" : "Save",
            };
          }}
          onClick={save}>{busy ? "Saving…" : row?.qb_ref ? "Save and attach in QuickBooks" : "Save"}</ActionButton>
      </DialogContent>
    </Dialog>
  );
}
