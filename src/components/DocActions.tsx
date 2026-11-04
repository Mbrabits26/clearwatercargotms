import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Paperclip, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ActionGuard";
import { QbAttachDialog, type AttachRow } from "@/components/QbAttachDialog";
import { deleteLoadDoc } from "@/lib/loadDocs.functions";
import { POD_QUERY_ROOTS } from "@/lib/podMark";
import { isSent } from "@/lib/qbAttachments";

const rowLabel = (r: AttachRow) =>
  r.kind === "bill" ? "Carrier bill" : `${r.kind === "fleet_invoice" ? "Foust Farms invoice" : "Customer invoice"}${r.invoice_number ? ` ${r.invoice_number}` : ""}`;

/** From the viewer: open the QuickBooks attach picker for this load's invoice or bill with this file ticked. */
export function AttachToQbButton({ path, name }: { path: string; name: string }) {
  const loadId = path.split("/")[0]!;
  const [row, setRow] = useState<AttachRow | null>(null);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["qb_sync", "attach-from-viewer", loadId],
    queryFn: async () => {
      const [{ data: rows }, { data: load }] = await Promise.all([
        supabase.from("qb_sync").select("id, kind, load_id, invoice_number, qb_ref, attachments, attachments_sent, attach_on_send").eq("load_id", loadId).order("created_at"),
        supabase.from("loads").select("id, load_number").eq("id", loadId).maybeSingle(),
      ]);
      return { rows: (rows ?? []) as AttachRow[], load };
    },
  });
  const rows = data?.rows ?? [];
  const loads = data?.load ? [data.load] : [];
  if (!rows.length) {
    return <Hint text="This load has no invoice or carrier bill in Accounting yet. Create the invoice first, then attach files to it."><Button size="sm" variant="outline" disabled><Paperclip className="mr-1 h-4 w-4" />Attach to QuickBooks</Button></Hint>;
  }
  const allSent = rows.every((r) => isSent(path, r.attachments_sent));
  const trigger = <Button size="sm" variant="outline" disabled={allSent} onClick={rows.length === 1 ? () => setRow(rows[0]!) : undefined}><Paperclip className="mr-1 h-4 w-4" />{allSent ? "In QuickBooks" : "Attach to QuickBooks"}</Button>;
  return (
    <>
      {rows.length === 1 ? (
        <Hint text={allSent ? "This file is already on the QuickBooks entry." : `Pick this file to send with ${rowLabel(rows[0]!).toLowerCase()} in QuickBooks.`}>{trigger}</Hint>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {rows.map((r) => (
              <DropdownMenuItem key={r.id} disabled={isSent(path, r.attachments_sent)} onSelect={() => setRow(r)}>
                {rowLabel(r)}{isSent(path, r.attachments_sent) ? " · already attached" : r.qb_ref ? " · in QuickBooks" : " · not sent yet"}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <QbAttachDialog row={row} loads={loads} preselect={{ path, name }} onClose={() => setRow(null)}
        onSaved={() => { setRow(null); qc.invalidateQueries({ queryKey: ["qb_sync"] }); }} />
    </>
  );
}

/** From the viewer: delete a load document (type DELETE to confirm). Signed rate cons are refused — void them instead. */
export function DeleteDocButton({ path, name, onDeleted }: { path: string; name: string; onDeleted: () => void }) {
  const qc = useQueryClient();
  const del = useServerFn(deleteLoadDoc);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const loadId = path.split("/")[0]!;
  const go = async () => {
    setBusy(true);
    try {
      const r = await del({ data: { path } });
      qc.invalidateQueries({ queryKey: ["load-docs", loadId] });
      qc.invalidateQueries({ queryKey: ["load-doc-names"] });
      qc.invalidateQueries({ queryKey: ["qb-attach-files"] });
      if (r.podCleared) qc.invalidateQueries({ predicate: (q) => POD_QUERY_ROOTS.includes(String(q.queryKey[0])) });
      toast.success(`Deleted ${r.deleted}`, {
        description: [r.podCleared && "No POD left on the load — it's back to POD missing.", r.inQuickBooks && "The copy already in QuickBooks stays there."].filter(Boolean).join(" ") || undefined,
      });
      setOpen(false);
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Hint text="Permanently remove this file from the load. Recorded in the admin deletion log.">
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => { setTyped(""); setOpen(true); }}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
      </Hint>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this document?</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>This permanently removes <b>{name}</b> from the load. It's recorded in the admin deletion log.</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>If it's the only POD, the load goes back to "POD missing".</li>
              <li>A copy already sent to QuickBooks stays in QuickBooks.</li>
              <li>Signed rate cons can't be deleted — void them on the Rate con panel instead.</li>
            </ul>
            <label className="block">Type <b className="font-mono text-gold">DELETE</b> to confirm
              <Input className="mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type DELETE to confirm" />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Keep it</Button>
              <Button variant="destructive" disabled={busy || typed.trim() !== "DELETE"} onClick={go}>{busy ? "Deleting…" : "Delete permanently"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
