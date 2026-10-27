import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileCheck2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, loadTotals, usd, type Load } from "@/lib/tms";
import { QB_REVIEW_LABEL, qbReviewState, type QbReviewState } from "@/lib/invoiceReview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ReportExport } from "@/components/ReportExport";
import { Hint } from "@/components/ActionGuard";
import { dayText, type ReportSpec } from "@/lib/reportExport";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadListBar } from "@/components/LoadListBar";
import { SelectAllBox, useSelection } from "@/components/BulkActionBar";
import { companiesQuery } from "@/lib/queries";

type SyncLite = { load_id: string; kind: string; status: string; qb_ref: string | null; invoice_number: string | null };
type Item = { l: Load; state: QbReviewState; customer: string; invoice: string | null };

const chunks = <T,>(a: T[], n = 150) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Query key sits under "qb_sync" so every Accounting queue change refreshes this list too. */
export const INVOICED_REVIEW_KEY = ["qb_sync", "invoiced_review"] as const;

/** Admin/accountant notice: loads moved to Invoiced whose customer invoice hasn't reached QuickBooks yet. */
export function InvoicedQbReview() {
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpenRaw] = useState(false);
  const sel = useSelection();
  const setOpen = (o: boolean) => { sel.clear(); setOpenRaw(o); };
  const { data: companies } = useQuery({ ...companiesQuery, enabled: open });
  const { data } = useQuery({
    queryKey: INVOICED_REVIEW_KEY,
    staleTime: 20_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Item[]> => {
      const { data: loads, error } = await supabase.from("loads").select("*").eq("status", "invoiced")
        .order("delivery_at", { ascending: false, nullsFirst: false }).limit(1000);
      if (error) throw error;
      const ls = (loads ?? []) as Load[];
      if (!ls.length) return [];
      const ids = ls.map((l) => l.id);
      const custIds = [...new Set(ls.map((l) => l.customer_id).filter((x): x is string => !!x))];
      const [syncParts, compParts] = await Promise.all([
        Promise.all(chunks(ids).map((c) => supabase.from("qb_sync").select("load_id, kind, status, qb_ref, invoice_number").neq("kind", "bill").in("load_id", c))),
        Promise.all(chunks(custIds).map((c) => supabase.from("companies").select("id, name").in("id", c))),
      ]);
      const sync = syncParts.flatMap((r) => (r.data ?? []) as SyncLite[]);
      const names = new Map(compParts.flatMap((r) => (r.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
      return ls.flatMap((l) => {
        const state = qbReviewState(l, sync);
        if (!state) return [];
        return [{ l, state, customer: names.get(l.customer_id ?? "") ?? "—", invoice: sync.find((s) => s.load_id === l.id && s.invoice_number)?.invoice_number ?? null }];
      });
    },
  });

  if (dismissed || !data?.length) return null;
  const count = (s: QbReviewState) => data.filter((x) => x.state === s).length;
  const errors = count("error");
  const total = data.reduce((t, x) => t + loadTotals(x.l).revenue, 0);

  return (
    <div className="mx-3 mt-2 flex items-center gap-2 rounded border border-primary/60 bg-primary/10 px-3 py-2 text-sm">
      <FileCheck2 className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <button type="button" className="font-bold underline" onClick={() => setOpen(true)}>
          {data.length} invoiced load{data.length > 1 ? "s" : ""} to review and sync with QuickBooks
        </button>
        <span className="text-muted-foreground"> · {usd(total)}{errors ? ` · ${errors} failed to send` : ""}</span>
      </span>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setDismissed(true)} aria-label="Hide until next visit"><X className="h-3.5 w-3.5" /></Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90dvh] w-[95vw] max-w-5xl flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Invoiced loads — QuickBooks review</DialogTitle>
            <DialogDescription>
              Loads marked Invoiced whose customer invoice isn't in QuickBooks yet: {count("not_queued")} not queued, {count("queued")} queued, {errors} failed. A load drops off this list once its invoice is sent.
            </DialogDescription>
          </DialogHeader>
          <LoadListBar loads={data.filter((x) => sel.has(x.l.id)).map((x) => x.l)} total={data.length} onClear={sel.clear} title="Invoiced loads — QuickBooks review"
            actions={["invoice", "status", "closeout", "export"]} companies={companies} customerName={(id) => data.find((x) => x.l.customer_id === id)?.customer ?? ""} />
          {!sel.picked.size && <p className="text-xs text-muted-foreground">Check loads (or the top box for all) to create their invoices, change status or close them out together.</p>}
          <div className="min-h-0 flex-1 overflow-auto rounded border">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow><TableHead className="w-8"><SelectAllBox ids={data.map((x) => x.l.id)} sel={sel} /></TableHead><TableHead>Load</TableHead><TableHead>Customer</TableHead><TableHead>Lane</TableHead><TableHead>Delivered</TableHead><TableHead>Amount</TableHead><TableHead>Invoice #</TableHead><TableHead>QuickBooks</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {data.map(({ l, state, customer, invoice }) => (
                  <TableRow key={l.id}>
                    <TableCell><Checkbox aria-label={`Select ${l.load_number}`} checked={sel.has(l.id)} onCheckedChange={(v) => sel.toggle(l.id, v === true)} /></TableCell>
                    <TableCell className="font-mono text-gold">{l.load_number}</TableCell>
                    <TableCell>{customer}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</TableCell>
                    <TableCell>{fmtDate(l.delivery_at)}</TableCell>
                    <TableCell>{usd(loadTotals(l).revenue)}</TableCell>
                    <TableCell>{invoice ?? <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <span className={cn("rounded border px-1.5 py-0.5 text-[11px]", state === "error" ? "border-destructive text-destructive" : state === "queued" ? "border-warning text-warning" : "border-muted-foreground/50 text-muted-foreground")}>{QB_REVIEW_LABEL[state]}</span>
                    </TableCell>
                    <TableCell>
<Hint text="Opens this load in Accounting so you can create or send its invoice."><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
                        <Link to="/quickbooks" search={{ q: l.load_number, review: true }} onClick={() => setOpen(false)}>Open</Link>
                      </Button></Hint>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <ReportExport build={(): ReportSpec => ({
              title: "Invoiced loads — QuickBooks review",
              summary: [["Loads", String(data.length)], ["Amount", usd(total)], ["Not queued", String(count("not_queued"))], ["Queued", String(count("queued"))], ["Failed", String(errors)]],
              head: ["Load", "Customer", "Lane", "Delivered", "Amount", "Invoice #", "QuickBooks"], right: [4],
              rows: data.map(({ l, state, customer, invoice }) => [l.load_number, customer, `${l.origin_city}, ${l.origin_state} → ${l.dest_city}, ${l.dest_state}`, l.delivery_at ? dayText(l.delivery_at) : "", usd(loadTotals(l).revenue), invoice ?? "", QB_REVIEW_LABEL[state]]),
              total: ["Total", `${data.length} loads`, "", "", usd(total), "", ""],
            })} />
            <Hint text="Opens Accounting filtered to invoiced loads not yet in QuickBooks."><Button asChild><Link to="/quickbooks" search={{ review: true }} onClick={() => setOpen(false)}>Review all in Accounting</Link></Button></Hint>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
