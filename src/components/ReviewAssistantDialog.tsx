import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { planReview } from "@/lib/reviewAssistant.functions";
import { qbScanInvoices, qbLinkInvoice } from "@/lib/quickbooks.functions";
import { matchRows, closeoutRows, type ReviewPlan, type MatchRow, type CloseoutLoad } from "@/lib/reviewAssistant";
import type { MatchLoad } from "@/lib/qbMatch";
import { invoiceNet } from "@/lib/invoiceDeductions";
import { fmtDate, usd, isFleetLoad, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReportExport } from "@/components/ReportExport";
import { datesLine, dayText, type ReportSpec } from "@/lib/reportExport";

type Sync = { load_id: string; kind: string; qb_ref: string | null; amount: number; deductions?: unknown };
type Props = { open: boolean; onOpenChange: (o: boolean) => void; loads: Load[]; companies: { id: string; name: string }[]; sync: Sync[] };

const EXAMPLES = [
  "Find loads paid in QuickBooks but not marked paid in the TMS",
  "Match Peak City Lumber invoices from this year",
  "Paid loads delivered over 30 days ago ready to close out",
];

export function ReviewAssistantDialog({ open, onOpenChange, loads, companies, sync }: Props) {
  const plan$ = useServerFn(planReview), scan = useServerFn(qbScanInvoices), link = useServerFn(qbLinkInvoice);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [closeouts, setCloseouts] = useState<CloseoutLoad[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const custName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? "";

  const candidates = useMemo(() => (entity: "brokerage" | "fleet"): MatchLoad[] => {
    const kind = entity === "fleet" ? "fleet_invoice" : "invoice";
    const linked = new Set(sync.filter((s) => s.qb_ref && s.kind === kind).map((s) => s.load_id));
    return loads.filter((l) => !linked.has(l.id) && isFleetLoad(l) === (entity === "fleet") && ["delivered", "invoiced", "paid"].includes(l.status)).map((l) => {
      const s = sync.find((x) => x.load_id === l.id && x.kind === kind);
      return { id: l.id, load_number: l.load_number, customer: custName(l.customer_id), customer_rate: Number(l.customer_rate), net: s ? invoiceNet(Number(s.amount), s.deductions) : undefined,
        origin_city: l.origin_city, origin_state: l.origin_state, dest_city: l.dest_city, dest_state: l.dest_state, delivery_at: l.delivery_at, pickup_at: l.pickup_at };
    });
  }, [loads, sync, companies]);

  const run = async (text = q) => {
    if (text.trim().length < 2) return;
    setQ(text); setBusy(true); setPicked(new Set()); setDone(new Set()); setMatches([]); setCloseouts([]);
    try {
      const p = await plan$({ data: { query: text, today: new Date().toISOString().slice(0, 10) } });
      setPlan(p);
      if (p.mode === "closeout") {
        setCloseouts(closeoutRows(p, loads.map((l) => ({ id: l.id, load_number: l.load_number, customer: custName(l.customer_id), status: l.status, closed_at: (l as { closed_at?: string | null }).closed_at ?? null, delivery_at: l.delivery_at, pickup_at: l.pickup_at, customer_rate: Number(l.customer_rate) }))));
      } else {
        const y = new Date().getFullYear();
        const r = await scan({ data: { from: p.from ?? `${y}-01-01`, to: p.to ?? new Date().toISOString().slice(0, 10), openOnly: false, entity: p.entity } });
        setMatches(matchRows(p, r.invoices, candidates(p.entity)));
      }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["qb_sync"] }); qc.invalidateQueries({ queryKey: ["loads"] }); qc.invalidateQueries({ queryKey: ["load-work"] }); };

  const linkPicked = async () => {
    if (!plan) return; setBusy(true); let n = 0;
    for (const r of matches.filter((m) => picked.has(m.invoice.id) && m.match && !done.has(m.invoice.id))) {
      try {
        await link({ data: { loadId: r.match!.load.id, qbId: r.invoice.id, amount: r.invoice.total, paid: r.invoice.balance <= 0, entity: plan.entity, docNumber: r.invoice.docNumber, customer: r.invoice.customer || null } });
        n++; setDone((d) => new Set(d).add(r.invoice.id));
      } catch (e) { toast.error(`${r.match!.load.load_number}: ${(e as Error).message}`); }
    }
    setBusy(false); setPicked(new Set()); refresh();
    if (n) toast.success(`Linked ${n} load${n > 1 ? "s" : ""} to their QuickBooks invoices. Nothing new was created in QuickBooks.`);
  };

  const closePicked = async () => {
    const ids = closeouts.filter((l) => picked.has(l.id) && !done.has(l.id)).map((l) => l.id);
    if (!ids.length || !note.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("batch_load_action", { _ids: ids, _action: "closeout", _note: note });
    setBusy(false);
    if (error) return toast.error(error.message);
    const res = data as unknown as { id: string; ok: boolean; error?: string }[];
    const ok = res.filter((r) => r.ok).map((r) => r.id);
    setDone((d) => new Set([...d, ...ok])); setPicked(new Set()); refresh();
    if (ok.length) toast.success(`Closed out ${ok.length} loads.`);
    res.filter((r) => !r.ok).forEach((r) => toast.error(`${closeouts.find((l) => l.id === r.id)?.load_number}: ${r.error}`));
  };

  const lvlText = (m: MatchRow["match"]) => !m ? "No match" : `${m.level === "high" ? "High" : m.level === "probable" ? "Probable" : "Review"} · ${m.score}`;
  const lvl = (m: MatchRow["match"]) => !m ? <Badge variant="outline">No match</Badge> : <Badge variant={m.level === "high" ? "default" : "secondary"}>{lvlText(m)}</Badge>;
  const day = (d?: string | null) => (d ? dayText(d) : "");

  /** Print / PDF / CSV of the assistant's current list. */
  const exportSpec = (): ReportSpec | null => {
    if (!plan) return null;
    const filters = [`Request: "${q.trim()}"`, plan.customer && `Customer: ${plan.customer}`, datesLine("Dates", plan.from ?? "", plan.to ?? ""), `Company: ${plan.entity === "fleet" ? "Foust Farms" : "Clearwater Cargo"}`].filter((x): x is string => !!x);
    const base = { title: plan.mode === "closeout" ? "Review assistant — loads to close out" : "Review assistant — QuickBooks matches", subtitle: plan.summary, company: plan.entity, filters };
    if (plan.mode === "closeout") return {
      ...base, summary: [["Loads", String(closeouts.length)], ["Customer amount", usd(closeouts.reduce((t, l) => t + l.customer_rate, 0))], ["Closed out here", String(closeouts.filter((l) => done.has(l.id)).length)]],
      head: ["Load", "Customer", "Delivered", "Rate", "Status"], right: [3],
      rows: closeouts.map((l) => [l.load_number, l.customer, day(l.delivery_at ?? l.pickup_at), usd(l.customer_rate), done.has(l.id) ? "Closed out" : l.status]),
    };
    return {
      ...base, summary: [["QuickBooks invoices", String(matches.length)], ["With a suggested load", String(matches.filter((m) => m.match).length)], ["High confidence", String(matches.filter((m) => m.match?.level === "high").length)], ["QB total", usd(matches.reduce((t, m) => t + m.invoice.total, 0))]],
      head: ["QB invoice", "QB date", "QB customer", "Total", "Balance", "TMS load", "TMS customer", "TMS rate", "TMS status", "Confidence", "Why"], right: [3, 4, 7],
      rows: matches.map((r) => {
        const l = r.match && loads.find((x) => x.id === r.match!.load.id);
        return [`#${r.invoice.docNumber ?? r.invoice.id}`, day(r.invoice.date), r.invoice.customer, usd(r.invoice.total), r.invoice.balance <= 0 ? "Paid" : usd(r.invoice.balance),
          r.match?.load.load_number ?? "", r.match?.load.customer ?? "", r.match ? usd(r.match.load.customer_rate) : "", done.has(r.invoice.id) ? "Linked" : l?.status ?? "", lvlText(r.match), r.match?.reasons.join(", ") ?? ""];
      }),
    };
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-gold" />Review assistant</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Ask in plain English. The assistant only builds a list — nothing changes until you check rows and confirm.</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <Input aria-label="Ask the review assistant" placeholder="e.g. Loads paid in QuickBooks but still open in the TMS" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" disabled={busy || q.trim().length < 2}>{busy ? "Working…" : "Search"}</Button>
        </form>
        <div className="flex flex-wrap gap-2">{EXAMPLES.map((x) => <Button key={x} size="sm" variant="outline" disabled={busy} onClick={() => run(x)}>{x}</Button>)}</div>
        {plan && <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm"><span className="text-gold">Showing:</span> {plan.summary}{plan.customer ? ` · ${plan.customer}` : ""}{plan.from || plan.to ? ` · ${plan.from ?? "…"} → ${plan.to ?? "today"}` : ""} · {plan.entity === "fleet" ? "Foust Farms" : "Clearwater"}</p>
          <ReportExport build={exportSpec} />
        </div>}

        {plan && plan.mode !== "closeout" && <>
          <div className="overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left"><tr><th className="p-2"></th><th className="p-2">QuickBooks invoice</th><th className="p-2">QB customer</th><th className="p-2">Total / balance</th><th className="p-2">TMS load</th><th className="p-2">TMS customer · rate</th><th className="p-2">Status</th><th className="p-2">Confidence</th><th className="p-2">Why</th></tr></thead>
              <tbody className="divide-y">{matches.map((r) => {
                const l = r.match && loads.find((x) => x.id === r.match!.load.id);
                return <tr key={r.invoice.id} className={done.has(r.invoice.id) ? "opacity-50" : ""}>
                  <td className="p-2"><Checkbox aria-label={`Select invoice ${r.invoice.docNumber}`} disabled={!r.match || done.has(r.invoice.id)} checked={picked.has(r.invoice.id)} onCheckedChange={() => toggle(r.invoice.id)} /></td>
                  <td className="p-2 font-mono">#{r.invoice.docNumber ?? r.invoice.id}<div className="text-muted-foreground">{r.invoice.date ? fmtDate(r.invoice.date) : ""}</div></td>
                  <td className="p-2">{r.invoice.customer}</td>
                  <td className="p-2">{usd(r.invoice.total)}<div className={r.invoice.balance <= 0 ? "text-success" : "text-muted-foreground"}>{r.invoice.balance <= 0 ? "Paid" : `Open ${usd(r.invoice.balance)}`}</div></td>
                  <td className="p-2 font-mono text-gold">{r.match?.load.load_number ?? "—"}<div className="text-muted-foreground font-sans">{l ? fmtDate(l.delivery_at ?? l.pickup_at) : ""}</div></td>
                  <td className="p-2">{r.match ? `${r.match.load.customer} · ${usd(r.match.load.customer_rate)}` : ""}</td>
                  <td className="p-2">{done.has(r.invoice.id) ? "Linked" : l?.status ?? ""}</td>
                  <td className="p-2">{lvl(r.match)}</td>
                  <td className="p-2 text-muted-foreground">{r.match?.reasons.join(", ")}</td>
                </tr>;
              })}</tbody>
            </table>
            {!matches.length && !busy && <p className="p-4 text-sm text-muted-foreground">No unlinked QuickBooks invoices found for this search.</p>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(matches.filter((m) => m.match?.level === "high" && !done.has(m.invoice.id)).map((m) => m.invoice.id)))}>Select high-confidence</Button>
            <Button disabled={busy || !picked.size} onClick={linkPicked}>Link {picked.size || ""} to QuickBooks invoices</Button>
          </div>
          <p className="text-xs text-muted-foreground">Linking attaches the load to the existing QuickBooks invoice (keeping its real number). Paid invoices mark the load Paid. Nothing is sent or created in QuickBooks.</p>
        </>}

        {plan?.mode === "closeout" && <>
          <div className="overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left"><tr><th className="p-2"><Checkbox aria-label="Select all" checked={!!closeouts.length && closeouts.every((l) => picked.has(l.id) || done.has(l.id))} onCheckedChange={(c) => setPicked(c ? new Set(closeouts.filter((l) => !done.has(l.id)).map((l) => l.id)) : new Set())} /></th><th className="p-2">Load</th><th className="p-2">Customer</th><th className="p-2">Delivered</th><th className="p-2">Rate</th><th className="p-2">Status</th></tr></thead>
              <tbody className="divide-y">{closeouts.map((l) => <tr key={l.id} className={done.has(l.id) ? "opacity-50" : ""}>
                <td className="p-2"><Checkbox aria-label={`Select ${l.load_number}`} disabled={done.has(l.id)} checked={picked.has(l.id)} onCheckedChange={() => toggle(l.id)} /></td>
                <td className="p-2 font-mono text-gold">{l.load_number}</td><td className="p-2">{l.customer}</td><td className="p-2">{fmtDate(l.delivery_at ?? l.pickup_at)}</td><td className="p-2">{usd(l.customer_rate)}</td><td className="p-2">{done.has(l.id) ? "Closed out" : l.status}</td>
              </tr>)}</tbody>
            </table>
            {!closeouts.length && !busy && <p className="p-4 text-sm text-muted-foreground">No paid loads waiting to be closed out for this search.</p>}
          </div>
          <Textarea aria-label="Closeout note" placeholder="Closeout note — e.g. paid in QuickBooks, reviewed" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end"><Button disabled={busy || !picked.size || !note.trim()} onClick={closePicked}>Close out {picked.size || ""} loads</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  );
}
