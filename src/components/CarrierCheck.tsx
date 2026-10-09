import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ClipboardCheck, Download, Loader2, Printer, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fixCarrierWithAi } from "@/lib/carrierFix.functions";
import { carrierIssues, type Carrier } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Fix = { patch: Record<string, unknown>; notes: string[] };
const FILTERS = [["all", "All with problems"], ["block", "Blocks booking"], ["docs", "Missing documents"], ["ins", "Insurance"], ["info", "Missing info"], ["inactive", "Inactive / DNU"]] as const;
const match: Record<string, (t: string) => boolean> = {
  all: () => true, block: () => true,
  docs: (t) => /W-9|COI|Agreement|NOA|file/.test(t), ins: (t) => /liability|Cargo/.test(t),
  info: (t) => /MC #|DOT #|Email|Phone|company blank/.test(t), inactive: (t) => /Authority|Do Not Use|Conditional/.test(t),
};
const LABELS: Record<string, string> = { auto_liability: "Auto liability", insurance_expires: "Liability expires", cargo_insurance: "Cargo limit", cargo_expires: "Cargo expires", factoring_company: "Factoring company", factoring_remit: "Factoring remit-to", pay_terms: "Pay option", mc_number: "MC #", dot_number: "DOT #" };

/** Carrier check report: lists every carrier problem with an AI fix that fills blank fields only. */
export function CarrierCheck({ carriers, onDone }: { carriers: Carrier[]; onDone?: () => void }) {
  const qc = useQueryClient();
  const fix = useServerFn(fixCarrierWithAi);
  const [flt, setFlt] = useState<string>("all");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [fixes, setFixes] = useState<Record<string, Fix>>({});
  const { data: docs = [] } = useQuery({ queryKey: ["carrier_documents_all"], queryFn: async () => (await supabase.from("carrier_documents").select("carrier_id, kind")).data ?? [] });
  const rows = useMemo(() => carriers.map((c) => ({ c, issues: carrierIssues(c, docs) })).filter((r) => r.issues.length)
    .filter((r) => flt === "block" ? r.issues.some((i) => i.level === "block") : r.issues.some((i) => match[flt](i.text))), [carriers, docs, flt]);

  const mark = (id: string, on: boolean) => setBusy((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });
  const check = async (c: Carrier) => {
    mark(c.id, true);
    try { const r = await fix({ data: { carrierId: c.id, apply: false } }); setFixes((f) => ({ ...f, [c.id]: r })); }
    catch (e) { toast.error(`${c.legal_name}: ${(e as Error).message}`); } finally { mark(c.id, false); }
  };
  const apply = async (c: Carrier) => {
    const f = fixes[c.id]; if (!f) return;
    mark(c.id, true);
    try { await fix({ data: { carrierId: c.id, apply: true, patch: f.patch } }); toast.success(`${c.legal_name} updated`); setFixes((x) => { const n = { ...x }; delete n[c.id]; return n; }); qc.invalidateQueries(); onDone?.(); }
    catch (e) { toast.error((e as Error).message); } finally { mark(c.id, false); }
  };
  const checkAll = async () => { for (const r of rows.slice(0, 25)) if (!fixes[r.c.id]) await check(r.c); };
  const csv = () => {
    const lines = [["Carrier", "MC", "DOT", "Status", "Problems"], ...rows.map((r) => [r.c.legal_name, r.c.mc_number ?? "", r.c.dot_number ?? "", r.c.status, r.issues.map((i) => i.text).join("; ")])];
    const blob = new Blob([lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "carrier-check.csv"; a.click();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.map(([k, l]) => <button key={k} onClick={() => setFlt(k)} className={cn("rounded border px-2 py-1 text-xs", flt === k ? "border-gold bg-gold/10 text-gold" : "text-muted-foreground")}>{l}</button>)}
        <div className="ml-auto flex gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={checkAll} disabled={busy.size > 0}><Sparkles className="mr-1 h-4 w-4" />Fix with AI (first 25)</Button>
          <Button size="sm" variant="outline" onClick={csv}><Download className="mr-1 h-4 w-4" />CSV</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{rows.length} carriers with problems. Fix with AI reads the carrier's uploaded documents and free FMCSA data and fills only blank fields — you approve each change. Each AI read uses a small amount of AI credit.</p>
      <div className="divide-y rounded border">
        {rows.map(({ c, issues }) => {
          const f = fixes[c.id]; const n = f ? Object.keys(f.patch).length : 0;
          return (
            <div key={c.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><div className="font-medium">{c.legal_name}</div><div className="text-xs text-muted-foreground">MC {c.mc_number ?? "—"} · DOT {c.dot_number ?? "—"} · {c.status}</div></div>
                <div className="flex gap-2 print:hidden">
                  {f && n > 0 && <Button size="sm" disabled={busy.has(c.id)} onClick={() => apply(c)}>Save {n} fixes</Button>}
                  <Button size="sm" variant="outline" disabled={busy.has(c.id)} onClick={() => check(c)}>{busy.has(c.id) ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}Fix with AI</Button>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">{issues.map((i) => <span key={i.text} className={cn("rounded border px-1.5 py-0.5 text-[11px]", i.level === "block" ? "border-destructive/50 text-destructive" : "border-warning/50 text-warning")}>{i.text}</span>)}</div>
              {f && (
                <div className="mt-2 rounded bg-muted/40 p-2 text-xs">
                  {n ? <ul className="grid gap-x-4 sm:grid-cols-2">{Object.entries(f.patch).map(([k, v]) => <li key={k}><span className="text-muted-foreground">{LABELS[k] ?? k.replace(/_/g, " ")}:</span> {String(v)}</li>)}</ul> : <p>Nothing new found in the documents or FMCSA — this needs the carrier.</p>}
                  {f.notes.map((x) => <p key={x} className="mt-1 text-warning">Needs carrier: {x}</p>)}
                </div>
              )}
            </div>
          );
        })}
        {!rows.length && <p className="p-4 text-sm text-muted-foreground">No problems found.</p>}
      </div>
    </div>
  );
}

export function CarrierCheckButton({ carriers, onDone }: { carriers: Carrier[]; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><ClipboardCheck className="mr-1 h-4 w-4" />Check carriers</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto">
          <DialogHeader><DialogTitle>Carrier check</DialogTitle></DialogHeader>
          {open && <CarrierCheck carriers={carriers} onDone={onDone} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
