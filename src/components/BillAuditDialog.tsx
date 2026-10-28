import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ReportExport } from "@/components/ReportExport";
import { LoadQuickLook } from "@/components/LoadQuickLook";
import { useSignedRcs, type BillRow } from "@/components/CarrierInvoiceDialog";
import { auditBill, auditFlags, parseChargeLines } from "@/lib/billAudit";
import { loadTotals, usd, type Load } from "@/lib/tms";
import type { ReportSpec } from "@/lib/reportExport";

type Filter = "problems" | "no_invoice" | "match" | "all";

/** Every carrier bill on the tab: carrier's invoice vs. signed rate con vs. current carrier pay. */
export function BillAuditDialog({ open, onOpenChange, loads, billOf, payeeOf, onAttach }: {
  open: boolean; onOpenChange: (o: boolean) => void; loads: Load[];
  billOf: (loadId: string) => BillRow | undefined; payeeOf: (l: Load) => string; onAttach: (l: Load) => void;
}) {
  const [filter, setFilter] = useState<Filter>("problems");
  const { data: rcs, isLoading } = useSignedRcs(open ? loads.map((l) => l.id) : []);
  const rows = useMemo(() => loads.map((l) => {
    const b = billOf(l.id);
    const rc = rcs?.[l.id];
    const a = auditBill({ rcTotal: rc?.total ?? null, rcLines: rc?.lines, loadCost: loadTotals(l).cost, billed: b?.carrier_invoice_amount != null ? Number(b.carrier_invoice_amount) : null, billedLines: parseChargeLines(b?.carrier_invoice_lines) });
    const flags = auditFlags(a);
    const problem = a.status === "over" || a.status === "under" || a.unexpected.length > 0 || a.rcChanged;
    return { l, b, a, flags, problem };
  }), [loads, rcs, billOf]);
  const counts = { problems: rows.filter((r) => r.problem).length, no_invoice: rows.filter((r) => r.a.status === "no_invoice").length, match: rows.filter((r) => r.a.status === "match" && !r.problem).length, all: rows.length };
  const shown = rows.filter((r) => filter === "all" || (filter === "problems" ? r.problem : filter === "match" ? r.a.status === "match" && !r.problem : r.a.status === "no_invoice"));
  const spec = (): ReportSpec => ({
    title: "Carrier bill audit", filters: [`Showing: ${LABEL[filter]}`],
    summary: [["Bills", String(rows.length)], ["Problems", String(counts.problems)], ["No carrier invoice", String(counts.no_invoice)], ["Matching", String(counts.match)]],
    head: ["Load", "Carrier / pay to", "Rate con", "Carrier pay now", "Carrier invoice #", "Billed", "Difference", "Notes"],
    right: [2, 3, 5, 6],
    rows: shown.map(({ l, b, a, flags }) => [l.load_number, payeeOf(l), usd(a.expected), usd(loadTotals(l).cost), b?.carrier_invoice_number ?? "", a.billed != null ? usd(a.billed) : "", a.billed != null ? usd(a.diff) : "", flags.join("; ")]),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader><DialogTitle>Carrier bill audit</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Compares each carrier's invoice with the signed rate con before it's posted. Read-only — fix the load or the carrier invoice, then send the bill.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(LABEL) as Filter[]).map((k) => <SelectItem key={k} value={k}>{LABEL[k]} ({counts[k]})</SelectItem>)}</SelectContent>
          </Select>
          {isLoading && <span className="text-xs text-muted-foreground">Loading signed rate cons…</span>}
          <ReportExport className="ml-auto" build={spec} />
        </div>
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader><TableRow><TableHead>Load</TableHead><TableHead>Pay to</TableHead><TableHead className="text-right">Rate con</TableHead><TableHead className="text-right">Billed</TableHead><TableHead className="text-right">Difference</TableHead><TableHead>Findings</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {shown.slice(0, 300).map(({ l, b, a, flags, problem }) => (
                <TableRow key={l.id}>
                  <TableCell><LoadQuickLook load={l} /></TableCell>
                  <TableCell className="max-w-48 truncate">{payeeOf(l)}{b?.carrier_invoice_number && <div className="text-[10px] text-muted-foreground">Inv {b.carrier_invoice_number}</div>}</TableCell>
                  <TableCell className="text-right">{usd(a.expected)}{!a.hasSignedRc && <div className="text-[10px] text-muted-foreground">unsigned</div>}</TableCell>
                  <TableCell className="text-right">{a.billed != null ? usd(a.billed) : "—"}</TableCell>
                  <TableCell className={`text-right ${a.diff > 0 ? "text-destructive" : a.diff < 0 ? "text-warning" : ""}`}>{a.billed != null ? usd(a.diff) : "—"}</TableCell>
                  <TableCell className="text-xs">
                    {!problem && a.status === "match" ? <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" />Matches</span>
                      : flags.map((f) => <div key={f} className="flex gap-1"><AlertTriangle className={`mt-0.5 h-3 w-3 shrink-0 ${problem ? "text-destructive" : "text-muted-foreground"}`} />{f}</div>)}
                  </TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => onAttach(l)}><Upload className="mr-1 h-3.5 w-3.5" />{b?.carrier_invoice_path ? "Review" : "Attach"}</Button></TableCell>
                </TableRow>
              ))}
              {!shown.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nothing here.</TableCell></TableRow>}
              {shown.length > 300 && <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground">Showing the first 300 — narrow the dates or search on the Carrier bills tab.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const LABEL: Record<Filter, string> = { problems: "Problems to check", no_invoice: "No carrier invoice yet", match: "Matching the rate con", all: "All bills" };
