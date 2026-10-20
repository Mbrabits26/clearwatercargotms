import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Maximize2, Minimize2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { qbScanInvoices, qbLinkInvoice } from "@/lib/quickbooks.functions";
import { rangeFor, rangeOptions, type RangeKey } from "@/lib/dateRanges";
import { bestMatches, type MatchLoad, type QbInvoice } from "@/lib/qbMatch";
import { invoiceNet } from "@/lib/invoiceDeductions";
import { fmtDate, usd, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type Props = { open: boolean; onOpenChange: (o: boolean) => void; loads: Load[]; companies: { id: string; name: string }[]; sync: { load_id: string; kind: string; qb_ref: string | null; amount: number; deductions?: unknown }[]; available?: { brokerage: boolean; fleet: boolean } };

export function QbReconcileDialog({ open, onOpenChange, loads, companies, sync, available }: Props) {
  const scan = useServerFn(qbScanInvoices);
  const link = useServerFn(qbLinkInvoice);
  const qc = useQueryClient();
  const [range, setRange] = useState<RangeKey>("ytd");
  const [[from, to], setDates] = useState<[string, string]>(rangeFor("ytd")!);
  const [openOnly, setOpenOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invoices, setInvoices] = useState<QbInvoice[] | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [full, setFull] = useState(false);
  const [entity, setEntity] = useState<"brokerage" | "fleet">(available && !available.brokerage && available.fleet ? "fleet" : "brokerage");
  const kind = entity === "fleet" ? "fleet_invoice" : "invoice";

  const candidates: MatchLoad[] = useMemo(() => {
    const linked = new Set(sync.filter((s) => s.qb_ref && s.kind === kind).map((s) => s.load_id));
    // Foust Farms QuickBooks only matches fleet loads; Clearwater only brokerage loads.
    return loads.filter((l) => !linked.has(l.id) && isFleetLoad(l) === (entity === "fleet") && ["delivered", "invoiced", "paid"].includes(l.status)).map((l) => {
      const s = sync.find((x) => x.load_id === l.id && x.kind === kind);
      return { id: l.id, load_number: l.load_number, customer: companies.find((c) => c.id === l.customer_id)?.name ?? "", customer_rate: Number(l.customer_rate), net: s ? invoiceNet(Number(s.amount), s.deductions) : undefined,
        origin_city: l.origin_city, origin_state: l.origin_state, dest_city: l.dest_city, dest_state: l.dest_state, delivery_at: l.delivery_at, pickup_at: l.pickup_at };
    });
  }, [loads, sync, companies, kind, entity]);

  const pickRange = (k: RangeKey) => { setRange(k); const r = rangeFor(k); if (r) setDates(r); };
  const run = async () => {
    setBusy(true);
    try { const r = await scan({ data: { from, to, openOnly, entity } }); setInvoices(r.invoices); toast.success(`Found ${r.invoices.length} unlinked QuickBooks invoices${r.alreadyLinked ? ` (${r.alreadyLinked} already linked)` : ""}.`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const doLink = async (inv: QbInvoice, loadId: string) => {
    try {
      const r = await link({ data: { loadId, qbId: inv.id, amount: inv.total, paid: inv.balance <= 0, entity } });
      setDone((d) => new Set(d).add(inv.id));
      toast.success(r.statusNote ? `Linked. Load status not changed: ${r.statusNote}` : "Linked to load.");
      qc.invalidateQueries({ queryKey: ["qb_sync"] }); qc.invalidateQueries({ queryKey: ["loads"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={full ? "flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col overflow-hidden sm:max-w-none sm:rounded-none" : "flex h-[90dvh] max-h-[90dvh] w-[96vw] max-w-none flex-col overflow-hidden sm:max-w-[96vw]"}>
        <DialogHeader className="flex-row items-center gap-2 pr-8"><DialogTitle className="min-w-0 flex-1 truncate">Match QuickBooks invoices to loads</DialogTitle>
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</Button>
        </DialogHeader>
        <p className="shrink-0 text-sm text-muted-foreground">Reads invoices from QuickBooks without changing them, then suggests loads by customer, amount, cities and date. Linking marks the load invoiced (or paid if QuickBooks shows no balance).</p>
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">Company
            <Select value={entity} onValueChange={(v) => { setEntity(v as typeof entity); setInvoices(null); setManual({}); }}>
              <SelectTrigger className="mt-1 w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="brokerage" disabled={available ? !available.brokerage : false}>Clearwater Cargo</SelectItem>
                <SelectItem value="fleet" disabled={available ? !available.fleet : false}>Foust Farms Trucking</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="text-xs text-muted-foreground">Dates
            <Select value={range} onValueChange={(v) => pickRange(v as RangeKey)}>
              <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{rangeOptions().map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="text-xs text-muted-foreground">From<DatePicker className="mt-1" value={from} onChange={(v) => { setRange("custom"); setDates([v, to]); }} /></label>
          <label className="text-xs text-muted-foreground">To<DatePicker className="mt-1" value={to} onChange={(v) => { setRange("custom"); setDates([from, v]); }} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />Unpaid only</label>
          <Button onClick={run} disabled={busy}>{busy ? "Scanning…" : "Scan QuickBooks"}</Button>
        </div>
        {invoices && (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border [&>div]:overflow-visible">
          <Table className="min-w-[900px]">
            <TableHeader className="sticky top-0 z-10 bg-background"><TableRow><TableHead>QuickBooks invoice</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Suggested load</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {invoices.filter((i) => !done.has(i.id)).map((inv) => {
                const m = bestMatches(inv, candidates);
                const best = m[0];
                const chosen = manual[inv.id] ?? best?.load.id ?? "";
                return (
                  <TableRow key={inv.id}>
                    <TableCell><div className="font-medium">#{inv.docNumber ?? inv.id}</div><div className="text-xs text-muted-foreground">{inv.date ? fmtDate(inv.date) : ""}</div><div className="max-w-56 truncate text-xs text-muted-foreground" title={inv.text}>{inv.text}</div></TableCell>
                    <TableCell>{inv.customer}</TableCell>
                    <TableCell className="text-right">{usd(inv.total)}<div className="text-xs text-muted-foreground">{inv.balance > 0 ? `${usd(inv.balance)} open` : "Paid"}</div></TableCell>
                    <TableCell>
                      {best ? <div className="mb-1 flex items-center gap-2"><Badge variant={best.level === "high" ? "default" : "secondary"}>{best.level === "high" ? "High match" : best.level === "probable" ? "Probable" : "Weak"}</Badge><span className="text-xs text-muted-foreground">{best.reasons.join(", ")}</span></div> : <Badge variant="outline">No match</Badge>}
                      <Select value={chosen} onValueChange={(v) => setManual((s) => ({ ...s, [inv.id]: v }))}>
                        <SelectTrigger className="w-72"><SelectValue placeholder="Pick a load" /></SelectTrigger>
                        <SelectContent>
                          {[...m.map((x) => x.load), ...candidates.filter((c) => !m.some((x) => x.load.id === c.id))].slice(0, 300).map((l) => (
                            <SelectItem key={l.id} value={l.id}>{l.load_number} · {l.customer || "—"} · {usd(l.customer_rate)} · {l.origin_city} → {l.dest_city}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Button size="sm" disabled={!chosen} onClick={() => doLink(inv, chosen)}>Link</Button></TableCell>
                  </TableRow>
                );
              })}
              {invoices.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No unlinked invoices in this range.</TableCell></TableRow>}
            </TableBody>
          </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
