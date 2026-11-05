import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportExport } from "@/components/ReportExport";
import { qbDuplicateAudit, qbCheckPaymentDoc } from "@/lib/qbAudit.functions";
import type { AuditInvoice, DupPair, LineMatch, PaymentDoc } from "@/lib/qbAudit";
import { usd } from "@/lib/tms";
import type { ReportSpec } from "@/lib/reportExport";

const toB64 = (buf: ArrayBuffer) => {
  let s = ""; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const co = (i: AuditInvoice) => (i.entity === "fleet" ? "Foust Farms" : "Clearwater");
const invLabel = (i: AuditInvoice) => `#${i.docNumber ?? "—"} (QB ${i.id})`;
const KIND: Record<DupPair["kind"], string> = { exact: "Exact double-post", "same-doc": "Same invoice #", "same-ref": "Same reference" };
const STATUS: Record<LineMatch["status"], string> = { matches: "Matches open balance", short: "Short paid", over: "Overpaid", "already-paid": "Already paid in QB", "not-found": "Not found in QB", ambiguous: "Several possible — check by hand" };
const yearAgo = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); };

function LoadCell({ i }: { i: AuditInvoice }) {
  if (!i.loadNumber) return <span className="text-muted-foreground">not in TMS</span>;
  return <Link to="/dispatch" search={{ load: i.loadId ?? undefined } as never} className="text-gold underline">{i.loadNumber}</Link>;
}

export function QbAuditDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const audit = useServerFn(qbDuplicateAudit);
  const check = useServerFn(qbCheckPaymentDoc);
  const [from, setFrom] = useState(yearAgo);
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<{ pairs: DupPair[]; counts: { brokerage: number; fleet: number }; skipped: string[] } | null>(null);
  const [pay, setPay] = useState<{ file: string; doc: PaymentDoc; matches: LineMatch[]; skipped: string[] } | null>(null);

  const runAudit = async () => {
    setBusy(true);
    try { setDups(await audit({ data: { from } })); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("Files must be 10 MB or smaller.");
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const name = file.name.toLowerCase();
      let payload: { fileName: string; mime: string; base64: string | null; text: string | null };
      if (/\.(xlsx|xls|csv)$/.test(name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        payload = { fileName: file.name, mime: "text/csv", base64: null, text: wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n]!)).join("\n\n").slice(0, 190_000) };
      } else if (/\.txt$/.test(name)) payload = { fileName: file.name, mime: "text/plain", base64: null, text: new TextDecoder().decode(buf).slice(0, 190_000) };
      else payload = { fileName: file.name, mime: file.type || (name.endsWith(".pdf") ? "application/pdf" : "image/jpeg"), base64: toB64(buf), text: null };
      const r = await check({ data: { ...payload, from } });
      setPay({ file: file.name, ...r });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const total = dups?.pairs.reduce((s, p) => s + p.overstated, 0) ?? 0;
  const dupSpec = (): ReportSpec | null => dups && ({
    title: "QuickBooks Duplicate Invoice Audit", filters: [`QuickBooks invoices dated ${from} or later`],
    summary: [["Clearwater invoices", String(dups.counts.brokerage)], ["Foust Farms invoices", String(dups.counts.fleet)], ["Possible doubles", String(dups.pairs.length)], ["Open A/R at risk", usd(total)]],
    head: ["Company", "Customer", "Amount", "Why", "Keep (load)", "Likely extra", "Extra open", "Extra date"],
    rows: dups.pairs.map((p) => [co(p.keep), p.keep.customer, usd(p.keep.total), KIND[p.kind] + (p.ref ? ` ${p.ref}` : ""), `${invLabel(p.keep)} ${p.keep.loadNumber ?? ""}`, invLabel(p.extra) + (p.extra.loadNumber ? ` ${p.extra.loadNumber}` : ""), usd(p.extra.balance), p.extra.date ?? ""]),
    total: ["", "", "", "", "", "Total", usd(total), ""], right: [2, 6],
  });
  const paySpec = (): ReportSpec | null => pay && ({
    title: "Payment Check Against QuickBooks", filters: [`File: ${pay.file}`],
    summary: [["Payer", pay.doc.payer ?? "—"], ["Check / ref", pay.doc.check_number ?? "—"], ["Date", pay.doc.date ?? "—"], ["Total", pay.doc.total != null ? usd(pay.doc.total) : "—"]],
    head: ["Paid ref", "Paid", "QB invoice", "Company", "Customer", "QB open", "Load", "Result"],
    rows: pay.matches.map((m) => [m.line.ref ?? "—", m.line.amount != null ? usd(m.line.amount) : "—", m.invoice ? invLabel(m.invoice) : "—", m.invoice ? co(m.invoice) : "", m.invoice?.customer ?? "", m.invoice ? usd(m.invoice.balance) : "", m.invoice?.loadNumber ?? "", STATUS[m.status] + (m.confidence === "probable" ? " (amount only)" : "")]),
    right: [1, 5],
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>QuickBooks check</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Look at QuickBooks invoices dated from</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          <span className="text-xs text-muted-foreground">Read-only — nothing is changed in QuickBooks.</span>
        </div>
        <Tabs defaultValue="dups">
          <TabsList><TabsTrigger value="dups">Duplicate invoices</TabsTrigger><TabsTrigger value="pay">Check a payment</TabsTrigger></TabsList>
          <TabsContent value="dups" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={runAudit} disabled={busy}><Search className="mr-1 h-4 w-4" />{busy ? "Reading QuickBooks…" : "Find duplicates"}</Button>
              {dups && <ReportExport build={dupSpec} />}
              {dups && <span className="text-sm">{dups.pairs.length} possible doubles · <b>{usd(total)}</b> open A/R at risk · read {dups.counts.brokerage} Clearwater + {dups.counts.fleet} Foust invoices</span>}
            </div>
            {dups?.skipped.map((s) => <div key={s} className="text-sm text-destructive">{s}</div>)}
            {dups && dups.pairs.length === 0 && <div className="text-sm text-muted-foreground">No duplicates found.</div>}
            {dups && dups.pairs.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Why</TableHead><TableHead>Keep</TableHead><TableHead>Likely extra</TableHead><TableHead className="text-right">Extra open</TableHead></TableRow></TableHeader>
                <TableBody>
                  {dups.pairs.map((p) => (
                    <TableRow key={p.keep.entity + p.keep.id + p.extra.id}>
                      <TableCell>{co(p.keep)}</TableCell><TableCell>{p.keep.customer}</TableCell><TableCell className="text-right">{usd(p.keep.total)}</TableCell>
                      <TableCell>{KIND[p.kind]}{p.ref ? ` ${p.ref}` : ""}</TableCell>
                      <TableCell>{invLabel(p.keep)} · {p.keep.date} · <LoadCell i={p.keep} /></TableCell>
                      <TableCell>{invLabel(p.extra)} · {p.extra.date} · <LoadCell i={p.extra} /></TableCell>
                      <TableCell className="text-right">{usd(p.extra.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-xs text-muted-foreground">When both invoices are tied to different loads, they may be two real shipments under one PO — check before voiding.</p>
          </TabsContent>
          <TabsContent value="pay" className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed p-6 text-sm text-muted-foreground hover:bg-muted/40"
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}>
              <Upload className="h-5 w-5" />
              {busy ? "Reading payment…" : "Drop or pick a check stub, remittance, ACH notice or deposit detail (PDF, photo, Excel/CSV)"}
              <input type="file" className="hidden" accept=".pdf,image/*,.xlsx,.xls,.csv,.txt" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {pay && (
              <>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span><b>{pay.doc.payer ?? "Unknown payer"}</b> · check/ref {pay.doc.check_number ?? "—"} · {pay.doc.date ?? "no date"} · total {pay.doc.total != null ? usd(pay.doc.total) : "—"}</span>
                  <ReportExport build={paySpec} />
                </div>
                {pay.skipped.map((s) => <div key={s} className="text-sm text-destructive">{s}</div>)}
                <Table>
                  <TableHeader><TableRow><TableHead>Paid ref</TableHead><TableHead className="text-right">Paid</TableHead><TableHead>QB invoice</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">QB open</TableHead><TableHead>Load</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {pay.matches.map((m, i) => (
                      <TableRow key={i}>
                        <TableCell>{m.line.ref ?? "—"}</TableCell>
                        <TableCell className="text-right">{m.line.amount != null ? usd(m.line.amount) : "—"}</TableCell>
                        <TableCell>{m.invoice ? `${co(m.invoice)} ${invLabel(m.invoice)}` : "—"}</TableCell>
                        <TableCell>{m.invoice?.customer ?? ""}</TableCell>
                        <TableCell className="text-right">{m.invoice ? usd(m.invoice.balance) : ""}</TableCell>
                        <TableCell>{m.invoice ? <LoadCell i={m.invoice} /> : ""}</TableCell>
                        <TableCell className={m.status === "matches" ? "text-primary" : "text-gold"}>{STATUS[m.status]}{m.confidence === "probable" ? " (amount only)" : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground">This only checks — record the payment in QuickBooks, then mark loads paid as usual.</p>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
