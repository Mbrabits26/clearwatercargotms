import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRouteContext } from "@tanstack/react-router";
import { DownloadCloud, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { importPackets } from "@/lib/packetImport.functions";
import { fmtDate } from "@/lib/tms";

type Row = { ref: string; name: string; action: string; docs: number; note?: string };
const LABEL: Record<string, string> = { new: "New carrier", merge: "Merge into existing", skip: "Skipped", error: "Problem" };

/** Admin-only: pull every submission from the separate carrier packet app into Carriers. */
export function PacketAppImportButton({ onDone }: { onDone: () => void }) {
  const { isAdmin } = useRouteContext({ from: "/_authenticated" });
  const run = useServerFn(importPackets);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [applied, setApplied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!isAdmin) return null;
  const go = async (apply: boolean) => {
    setBusy(true); setProblem(null);
    try {
      const r = await run({ data: { apply } });
      if (!r.ok) { setProblem(r.problem); return; }
      setRows(r.rows); setApplied(apply);
      if (apply) { toast.success("Packets imported"); onDone(); }
    } catch (e) { setProblem(e instanceof Error ? e.message : "Import failed"); }
    finally { setBusy(false); }
  };
  const count = (a: string) => rows?.filter((r) => r.action === a).length ?? 0;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setOpen(true); setRows(null); go(false); }}><DownloadCloud className="mr-1 h-4 w-4" />Import from packet app</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{applied ? "Import complete" : "Import carrier packets"}</DialogTitle></DialogHeader>
          {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{applied ? "Importing…" : "Checking the packet app…"}</p>}
          {problem && <p className="rounded border border-warning/50 bg-warning/10 p-3 text-sm">{problem}</p>}
          {rows && (
            <>
              <p className="text-sm">{count("new")} new · {count("merge")} {applied ? "merged" : "to merge"} · {count("skip")} already imported{count("error") ? ` · ${count("error")} problems` : ""}</p>
              <ul className="max-h-80 divide-y overflow-auto text-sm">
                {rows.map((r) => (
                  <li key={r.ref} className="flex justify-between gap-2 py-1.5">
                    <span>{r.name} <span className="text-xs text-muted-foreground">{r.ref}</span></span>
                    <span className="text-xs">{LABEL[r.action]}{r.docs ? ` · ${r.docs} docs` : ""}{r.note ? ` · ${r.note}` : ""}</span>
                  </li>
                ))}
              </ul>
              {!applied && <Button disabled={busy || !(count("new") + count("merge"))} onClick={() => go(true)}>Import {count("new") + count("merge")} packets</Button>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Proof of online signing imported from the packet app. */
export function SignatureRecords({ carrierId }: { carrierId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["carrier_signatures", carrierId],
    queryFn: async () => (await supabase.from("carrier_signatures").select("*").eq("carrier_id", carrierId).order("signed_at", { ascending: false })).data ?? [],
  });
  if (!data.length) return null;
  return (
    <div className="rounded border bg-card p-4 text-sm">
      <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold uppercase tracking-widest text-gold"><ShieldCheck className="h-4 w-4" />Signed online</h3>
      {data.map((s) => (
        <div key={s.id} className="grid grid-cols-1 gap-x-4 text-xs sm:grid-cols-2">
          <span>Signer: <b>{s.signer_name ?? "—"}</b>{s.signer_title ? `, ${s.signer_title}` : ""}</span>
          <span>Signed: {fmtDate(s.signed_at)} {s.signed_at && new Date(s.signed_at).toLocaleTimeString()}</span>
          <span>IP address: {s.signer_ip ?? "—"}</span>
          <span>Reference: {s.external_ref}</span>
          <span className="sm:col-span-2 truncate text-muted-foreground">Device: {s.user_agent ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}
