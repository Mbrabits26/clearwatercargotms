import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Send, PlugZap, Pencil, Trash2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { carriersQuery, companiesQuery, loadsQuery } from "@/lib/queries";
import { effectivePayTerms, fmtDate, loadTotals, usd, type Load } from "@/lib/tms";
import { buildInvoicePdf, loadImage } from "@/lib/invoice";
import { DocLink, useBlobViewer } from "@/components/DocPreview";
import { composeEmail, getMailClient } from "@/lib/email";
import logo from "@/assets/clearwater-logo.jpg.asset.json";
import { Upload, FileText, Mail, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadQuickLook } from "@/components/LoadQuickLook";
import { cn } from "@/lib/utils";

type SyncRow = {
  id: string;
  load_id: string;
  kind: string;
  payee: string | null;
  amount: number;
  status: string;
  qb_ref: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  invoice_number: string | null;
  gross_amount: number | null;
  quickpay_fee: number;
  carrier_invoice_amount: number | null;
  carrier_invoice_path: string | null;
};
type Kind = "invoice" | "fleet_invoice" | "bill";
const KIND_LABEL: Record<string, string> = { invoice: "Invoice (AR)", fleet_invoice: "Fleet billing (AR)", bill: "Carrier bill (AP)" };

export const Route = createFileRoute("/_authenticated/quickbooks")({
  head: () => ({
    meta: [
      { title: "Accounting — Clearwater Cargo TMS" },
      { name: "description", content: "Customer invoices (AR), carrier bills (AP) and the QuickBooks Online sync queue." },
      { property: "og:title", content: "Accounting — Clearwater Cargo TMS" },
      { property: "og:description", content: "Customer invoices (AR), carrier bills (AP) and the QuickBooks Online sync queue." },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/dispatch" });
  },
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(loadsQuery),
      context.queryClient.ensureQueryData(companiesQuery),
      context.queryClient.ensureQueryData(carriersQuery),
    ]),
  component: Accounting,
});

function Accounting() {
  const { data: loads } = useSuspenseQuery(loadsQuery);
  const { data: companies } = useSuspenseQuery(companiesQuery);
  const { data: carriers } = useSuspenseQuery(carriersQuery);
  const qc = useQueryClient();
  const { data: sync = [] } = useQuery({
    queryKey: ["qb_sync"],
    queryFn: async () => ((await supabase.from("qb_sync").select("*").order("created_at", { ascending: false })).data ?? []) as SyncRow[],
  });
  const [tab, setTab] = useState<Kind | "log">("invoice");
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<SyncRow | null>(null);

  const synced = (id: string, kind: string) => sync.find((s) => s.load_id === id && s.kind === kind);
  const delivered = loads.filter((l) => ["delivered", "invoiced"].includes(l.status));
  // Loads hauled by our own trucks for outside brokerages are billed separately from brokerage customer invoices.
  const ar = delivered.filter((l) => !l.truck_id);
  const fleetAr = delivered.filter((l) => !!l.truck_id);
  const ap = loads.filter((l) => l.carrier_id && l.pod_received && ["delivered", "invoiced", "paid"].includes(l.status));
  const ap0 = ap.filter((l) => !l.truck_id);
  const rows = tab === "invoice" ? ar : tab === "fleet_invoice" ? fleetAr : ap0;
  const carrierOf = (l: Load) => carriers.find((x) => x.id === l.carrier_id);
  /** Carrier bill math: rate con total minus the Quick Pay fee for the load's pay terms. */
  const billMath = (l: Load) => {
    const gross = loadTotals(l).cost;
    const pt = effectivePayTerms(l, carrierOf(l));
    const fee = Math.round(gross * pt.fee * 100) / 100;
    return { gross, fee, net: gross - fee, pt };
  };
  const amountFor = (l: Load, kind: Kind) => (kind === "bill" ? billMath(l).net : loadTotals(l).revenue);
  const viewer = useBlobViewer();
  const invoicePdf = async (s: SyncRow) => {
    const l = loads.find((x) => x.id === s.load_id);
    if (!l || !s.invoice_number) return null;
    return buildInvoicePdf({ invoiceNumber: s.invoice_number, load: l, billTo: companies.find((c) => c.id === l.customer_id), amount: Number(s.amount), logo: await loadImage(logo.url) });
  };
  const viewInvoice = async (s: SyncRow) => { const d = await invoicePdf(s); if (d) viewer.show(d.output("blob"), `${s.invoice_number}.pdf`); };
  const emailInvoice = async (s: SyncRow) => {
    const l = loads.find((x) => x.id === s.load_id); const d = await invoicePdf(s);
    if (!l || !d) return;
    d.save(`${s.invoice_number}.pdf`);
    const to = companies.find((c) => c.id === l.customer_id)?.email ?? "";
    await composeEmail(to, `Invoice ${s.invoice_number} — Load ${l.load_number} — Clearwater Cargo`,
      `Hello,\n\nPlease find invoice ${s.invoice_number} for load ${l.load_number} (${l.origin_city}, ${l.origin_state} to ${l.dest_city}, ${l.dest_state}) attached. Amount due: ${usd(Number(s.amount))}, Net 30.${l.pod_received ? " The signed POD is on file and available on request." : ""}\n\nThank you,\nClearwater Cargo LLC · 252-497-7916`, getMailClient());
    toast.success("Invoice PDF downloaded and email started — attach the PDF.");
  };
  const uploadCarrierInvoice = async (s: SyncRow, file?: File) => {
    if (!file) return;
    const amt = Number(prompt("Amount on the carrier's invoice ($)?", String(s.gross_amount ?? s.amount)) ?? "");
    const path = `${s.load_id}/carrier_invoice-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await supabase.storage.from("load-docs").upload(path, file);
    if (error) return toast.error(error.message);
    await supabase.from("qb_sync").update({ carrier_invoice_path: path, carrier_invoice_amount: Number.isFinite(amt) && amt > 0 ? amt : null }).eq("id", s.id);
    toast.success("Carrier invoice attached");
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };

  const payee = (l: Load, kind: string) => {
    if (kind !== "bill") return companies.find((c) => c.id === l.customer_id)?.name ?? "Unknown customer";
    const c = carriers.find((x) => x.id === l.carrier_id);
    return c?.factoring_company ? `${c.factoring_company} (for ${c.legal_name})` : c?.legal_name ?? "Unknown carrier";
  };

  const ageDays = (l: Load) => (l.delivery_at ? Math.max(0, Math.floor((Date.now() - new Date(l.delivery_at).getTime()) / 86400_000)) : null);

  const send = async () => {
    const chosen = rows.filter((l) => picked.includes(l.id));
    if (!chosen.length) return toast.info("Select at least one load.");
    const kind = tab as Kind;
    const { error } = await supabase.from("qb_sync").upsert(
      chosen.map((l) => ({
        load_id: l.id,
        kind,
        payee: payee(l, kind),
        amount: amountFor(l, kind),
        gross_amount: kind === "bill" ? billMath(l).gross : loadTotals(l).revenue,
        quickpay_fee: kind === "bill" ? billMath(l).fee : 0,
        status: "queued",
        error: null,
      })),
      { onConflict: "load_id,kind" },
    );
    if (error) return toast.error(error.message);
    if (kind !== "bill") {
      await supabase.from("loads").update({ status: "invoiced" }).in("id", chosen.filter((l) => l.status === "delivered").map((l) => l.id));
      qc.invalidateQueries({ queryKey: ["loads"] });
    }
    toast.success(`${chosen.length} ${kind === "bill" ? "bill(s)" : "invoice(s)"} queued for QuickBooks`);
    setPicked([]);
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };

  const remove = async (s: SyncRow) => {
    if (!confirm(`Remove this ${s.kind === "bill" ? "bill" : "invoice"} from the queue? The load itself is not changed.`)) return;
    const { error } = await supabase.from("qb_sync").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Removed from the queue.");
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };

  const retry = async (s: SyncRow) => {
    const { error } = await supabase.from("qb_sync").update({ status: "queued", error: null }).eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Queued again for sending.");
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };

  const paidStatus = (l?: Load) => l?.status === "paid";
  const loadOf = (id: string) => loads.find((l) => l.id === id);
  const age = (s: SyncRow) => { const l = loadOf(s.load_id); return l ? ageDays(l) ?? 0 : 0; };
  const bucket = (list: SyncRow[]) => {
    const open = list.filter((s) => !paidStatus(loadOf(s.load_id)));
    const sum = (f: (a: number) => boolean) => open.filter((s) => f(age(s))).reduce((t, s) => t + Number(s.amount), 0);
    return { total: sum(() => true), a: sum((a) => a <= 30), b: sum((a) => a > 30 && a <= 60), c: sum((a) => a > 60) };
  };
  const arB = bucket(sync.filter((s) => s.kind !== "bill"));
  const apB = bucket(sync.filter((s) => s.kind === "bill"));
  const qpRevenue = sync.filter((s) => s.kind === "bill").reduce((t, s) => t + Number(s.quickpay_fee || 0), 0);

  return (
    <div className="space-y-5 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold uppercase">Accounting</h1>
        {tab !== "log" && <Button onClick={send}><Send className="mr-1 h-4 w-4" />Send selected to QuickBooks</Button>}
      </div>
      <div className="flex items-center gap-3 rounded border border-warning/50 bg-warning/10 p-3 text-sm">
        <PlugZap className="h-4 w-4 text-warning" />
        <span>QuickBooks isn't connected yet. Items you send wait in the queue and go out automatically once your QuickBooks account is linked.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Aging k="Receivables — owed to us (AR)" b={arB} />
        <Aging k="Payables — we owe carriers (AP)" b={apB} />
        <Stat k="Quick Pay fee revenue" v={usd(qpRevenue)} />
      </div>
      <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setPicked([]); }}>
        <TabsList>
          <TabsTrigger value="invoice">Customer invoices (AR)</TabsTrigger>
          <TabsTrigger value="fleet_invoice">Fleet billing (AR)</TabsTrigger>
          <TabsTrigger value="bill">Carrier bills (AP)</TabsTrigger>
          <TabsTrigger value="log">Sync log</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="overflow-x-auto rounded-md border bg-card">
        {tab === "log" ? (
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Load</TableHead><TableHead>Payee / customer</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Queued</TableHead><TableHead className="w-24">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {sync.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{KIND_LABEL[s.kind] ?? s.kind}{s.invoice_number && <div className="text-[10px] text-gold">{s.invoice_number}</div>}</TableCell>
                  <TableCell>{loads.find((l) => l.id === s.load_id) ? <LoadQuickLook load={loads.find((l) => l.id === s.load_id)!} /> : "—"}</TableCell>
                  <TableCell>{s.payee}</TableCell>
                  <TableCell>{usd(Number(s.amount))}</TableCell>
                  <TableCell>
                    <Pill status={s.status} />
                    {s.error && <div className="mt-1 max-w-56 text-[10px] text-destructive">{s.error}</div>}
                  </TableCell>
                  <TableCell>{fmtDate(s.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" title="Edit amount / payee" onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                      {s.status === "error" && <Button size="icon" variant="ghost" title="Retry" onClick={() => retry(s)}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                      <Button size="icon" variant="ghost" title="Remove from queue" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!sync.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nothing sent yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input type="checkbox" checked={picked.length > 0 && picked.length === rows.length} onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.id) : [])} />
                </TableHead>
                <TableHead>Load</TableHead><TableHead>Lane</TableHead><TableHead>{tab === "bill" ? "Pay to" : tab === "fleet_invoice" ? "Bill outside broker" : "Bill to"}</TableHead><TableHead>Delivered</TableHead><TableHead>Age</TableHead><TableHead>Amount</TableHead><TableHead>{tab === "bill" ? "Carrier invoice" : "Invoice"}</TableHead><TableHead>QuickBooks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => {
                const s = synced(l.id, tab as Kind);
                const bm = tab === "bill" ? billMath(l) : null;
                const mismatch = s?.carrier_invoice_amount != null && bm && Math.abs(Number(s.carrier_invoice_amount) - bm.gross) > 0.009;
                const age = ageDays(l);
                return (
                  <TableRow key={l.id}>
                    <TableCell><input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} /></TableCell>
                    <TableCell><LoadQuickLook load={l} /></TableCell>
                    <TableCell>{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</TableCell>
                    <TableCell>{payee(l, tab as Kind)}</TableCell>
                    <TableCell>{fmtDate(l.delivery_at)}</TableCell>
                    <TableCell className={cn(age !== null && age > 30 && tab !== "bill" && "text-destructive font-medium")}>{age !== null ? `${age}d` : "—"}</TableCell>
                    <TableCell>
                      {usd(amountFor(l, tab as Kind))}
                      {bm && bm.fee > 0 && <div className="text-[10px] text-muted-foreground">{usd(bm.gross)} − {usd(bm.fee)} {bm.pt.value === "quickpay" ? "Quick Pay 5%" : "Factored QP 2.5%"}</div>}
                    </TableCell>
                    <TableCell>
                      {tab === "bill" ? (
                        s ? (
                          <div className="flex flex-col gap-1 text-xs">
                            {s.carrier_invoice_path ? <DocLink items={[{ name: "Carrier invoice", bucket: "load-docs", path: s.carrier_invoice_path }]}><FileText className="mr-1 inline h-3 w-3" />{s.carrier_invoice_amount != null ? usd(Number(s.carrier_invoice_amount)) : "View"}</DocLink> : null}
                            {mismatch && <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3" />Differs from rate con {usd(bm!.gross)}</span>}
                            <label className="cursor-pointer text-muted-foreground underline"><Upload className="mr-1 inline h-3 w-3" />{s.carrier_invoice_path ? "Replace" : "Attach"}
                              <input type="file" className="hidden" onChange={(e) => { uploadCarrierInvoice(s, e.target.files?.[0]); e.target.value = ""; }} /></label>
                          </div>
                        ) : <span className="text-xs text-muted-foreground">Queue bill first</span>
                      ) : s?.invoice_number ? (
                        <div className="flex items-center gap-1 text-xs">
                          <button className="text-gold underline" onClick={() => viewInvoice(s)}>{s.invoice_number}</button>
                          <Button size="icon" variant="ghost" title="Email invoice" onClick={() => emailInvoice(s)}><Mail className="h-3.5 w-3.5" /></Button>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">Assigned when queued</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {s ? <Pill status={s.status} /> : <span className="text-xs text-muted-foreground">Not sent</span>}
                        {s && <Button size="icon" variant="ghost" title="Edit amount / payee" onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /></Button>}
                        {s && s.status === "error" && <Button size="icon" variant="ghost" title="Retry" onClick={() => retry(s)}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                        {s && <Button size="icon" variant="ghost" title="Remove from queue" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">{tab === "bill" ? "No loads with a signed POD yet." : tab === "fleet_invoice" ? "No delivered loads hauled by our own trucks." : "No delivered loads to invoice."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </div>
      {viewer.viewer}
      <EditSyncDialog row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["qb_sync"] }); }} />
    </div>
  );
}

function EditSyncDialog({ row, onClose, onSaved }: { row: SyncRow | null; onClose: () => void; onSaved: () => void }) {
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (row && openFor !== row.id) {
    setOpenFor(row.id);
    setPayee(row.payee ?? "");
    setAmount(String(row.amount));
  }

  const save = async () => {
    if (!row) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return toast.error("Enter a valid amount.");
    const { error } = await supabase.from("qb_sync").update({ payee: payee.trim() || null, amount: amt }).eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Updated.");
    onSaved();
  };

  return (
    <Dialog open={!!row} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Edit {row?.kind === "bill" ? "bill" : "invoice"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="text-xs text-muted-foreground">Payee / customer
            <Input className="mt-1" value={payee} onChange={(e) => setPayee(e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground">Amount
            <Input className="mt-1" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <Button className="w-full" onClick={save}>Save changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="font-display text-3xl text-gold">{v}</div>
    </div>
  );
}
function Aging({ k, b }: { k: string; b: { total: number; a: number; b: number; c: number } }) {
  return (
    <div className="rounded border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="font-display text-3xl text-gold">{usd(b.total)}</div>
      <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground"><span>0–30d {usd(b.a)}</span><span>31–60d {usd(b.b)}</span><span className={b.c > 0 ? "text-destructive" : ""}>60+d {usd(b.c)}</span></div>
    </div>
  );
}
function Pill({ status }: { status: string }) {
  const cls = status === "sent" ? "border-success text-success" : status === "error" ? "border-destructive text-destructive" : "border-warning text-warning";
  return <span className={cn("rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider", cls)}>{status}</span>;
}
