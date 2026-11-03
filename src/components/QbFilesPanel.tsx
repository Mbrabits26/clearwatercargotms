import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudDownload, ExternalLink, FileText } from "lucide-react";
import { qbImportFile, qbInvoiceFiles } from "@/lib/quickbooks.functions";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ActionGuard";

type QbFileRow = { id: string; invoiceId: string; name: string; size: number; url: string | null; pod: boolean; entity: "brokerage" | "fleet" };

/**
 * Pulls the files attached to a load's QuickBooks invoice (or one invoice from the match list) so a POD
 * can be looked at and saved onto the load — and the load closed out — without leaving the screen.
 */
export function QbFilesPanel({ loadId, entity, qbId, compact }: { loadId: string; entity?: "brokerage" | "fleet"; qbId?: string; compact?: boolean }) {
  const list = useServerFn(qbInvoiceFiles);
  const imp = useServerFn(qbImportFile);
  const qc = useQueryClient();
  const [files, setFiles] = useState<QbFileRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [closeout, setCloseout] = useState(false);

  const load = async () => {
    setBusy("list");
    try {
      const r = await list({ data: qbId && entity ? { entity, qbIds: [qbId] } : { loadId } });
      if (!r.linked) toast.info("This load isn't linked to a QuickBooks invoice yet.");
      setFiles(r.files as QbFileRow[]);
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };
  const save = async (f: QbFileRow, type: "pod" | "other") => {
    setBusy(f.id);
    try {
      const r = await imp({ data: { loadId, entity: f.entity, attachableId: f.id, type, markPod: type === "pod", closeout: type === "pod" && closeout } });
      setDone((d) => new Set(d).add(f.id));
      toast.success(type === "pod" ? `POD saved to the load${closeout ? " and closed out" : ""}.` : "File saved to the load.");
      r.notes.forEach((n) => toast.warning(n));
      qc.invalidateQueries({ queryKey: ["load-docs", loadId] });
      qc.invalidateQueries({ queryKey: ["loads"] });
      qc.invalidateQueries({ queryKey: ["load-work"] });
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };

  if (!files) return (
    <Button size="sm" variant="outline" disabled={busy === "list"} onClick={load} className={compact ? "h-7 px-2 text-xs" : ""}>
      <CloudDownload className="mr-1 h-3.5 w-3.5" />{busy === "list" ? "Checking QuickBooks…" : "PODs from QuickBooks"}
    </Button>
  );
  return (
    <div className="space-y-1.5 rounded-md border p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <b className="uppercase tracking-wider text-gold">Files on the QuickBooks invoice</b>
        <label className="flex items-center gap-1"><input type="checkbox" checked={closeout} onChange={(e) => setCloseout(e.target.checked)} />Close out the load when I save a POD</label>
      </div>
      {!files.length && <div className="text-muted-foreground">No files are attached to this invoice in QuickBooks.</div>}
      {files.map((f) => (
        <div key={f.id} className="flex flex-wrap items-center gap-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          {f.pod && <span className="rounded border border-success/60 px-1 text-[10px] text-success">Looks like a POD</span>}
          {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary underline"><ExternalLink className="h-3 w-3" />Review</a>}
          {done.has(f.id) ? <span className="text-success">Saved</span> : (<>
            <ActionButton size="sm" className="h-7 px-2 text-xs" disabled={!!busy} hint="Copies this file onto the load as its signed POD and ticks 'Signed POD received'."
              confirm={() => ({ title: `Save ${f.name} as the POD?`, points: ["Open Review first and check it's the signed POD for this load.", "The file is copied onto the load and 'Signed POD received' is ticked.", closeout ? "The load is closed out (operational archive only — payment stays as it is)." : "The load stays open.", "Nothing changes in QuickBooks."], confirmLabel: "Save POD" })}
              onClick={() => save(f, "pod")}>Save as POD</ActionButton>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => save(f, "other")}>Save as other</Button>
          </>)}
        </div>
      ))}
    </div>
  );
}
