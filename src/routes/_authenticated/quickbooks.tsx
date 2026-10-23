import { useReviewChanges, diff } from "@/components/ReviewChanges";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { qbReviewState } from "@/lib/invoiceReview";
import { DatePicker } from "@/components/DatePicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rangeFor, rangeOptions, type RangeKey } from "@/lib/dateRanges";
import { toast } from "sonner";
import { Send, PlugZap, Pencil, Trash2, RotateCcw, Search, Paperclip } from "lucide-react";
import { QbAttachDialog } from "@/components/QbAttachDialog";
import { parseAttachments } from "@/lib/qbAttachments";
import { supabase } from "@/integrations/supabase/client";
import { carriersQuery, companiesQuery, loadsQuery } from "@/lib/queries";
import { CUSTOMER_TERMS, termsDays, effectivePayTerms, fmtDate, isFleetLoad, loadTotals, usd, type Load } from "@/lib/tms";
import { BatchInvoiceDialog } from "@/components/BatchInvoiceDialog";
import { invoiceKind } from "@/lib/batchInvoice";
import { QbReconcileDialog } from "@/components/QbReconcileDialog";
import { ReviewAssistantDialog } from "@/components/ReviewAssistantDialog";
import { ReportExport } from "@/components/ReportExport";
import { datesLine, dayText, type ReportSpec } from "@/lib/reportExport";
import { buildInvoicePdf, loadImage } from "@/lib/invoice";
import { DEDUCTION_PRESETS, invoiceNet, parseDeductions, type Deduction } from "@/lib/invoiceDeductions";
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
import { useServerFn } from "@tanstack/react-start";
import { qbStatus, qbStartConnect, qbDisconnect, qbSyncNow } from "@/lib/quickbooks.functions";

/** What the customer owes on an invoice row after percentage deductions; bills unchanged. */
const owed = (s: { kind: string; amount: number; deductions?: unknown }) => (s.kind === "bill" ? Number(s.amount) : invoiceNet(Number(s.amount), s.deductions));

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
  qb_class?: string | null;
  gross_amount: number | null;
  quickpay_fee: number;
  deductions?: unknown;
  carrier_invoice_amount: number | null;
  carrier_invoice_path: string | null;
  terms?: string | null;
  due_date?: string | null;
  attachments?: unknown;
  attachments_sent?: unknown;
  attach_on_send?: boolean;
  attach_error?: string | null;
};
const attachCount = (s: SyncRow) => parseAttachments(s.attachments).length;
type Kind = "invoice" | "fleet_invoice" | "bill";
const KIND_LABEL: Record<string, string> = { invoice: "Invoice (AR)", fleet_invoice: "Fleet billing (AR)", bill: "Carrier bill (AP)" };

export const Route = createFileRoute("/_authenticated/quickbooks")({
  validateSearch: (s: Record<string, unknown>): { q?: string; review?: boolean } => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    review: s.review === true || s.review === "true" || s.review === 1 || s.review === "1" ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Accounting — Clearwater Cargo TMS" },
      { name: "description", content: "Customer invoices (AR), carrier bills (AP) and the QuickBooks Online sync queue." },
      { property: "og:title", content: "Accounting — Clearwater Cargo TMS" },
      { property: "og:description", content: "Customer invoices (AR), carrier bills (AP) and the QuickBooks Online sync queue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(loadsQuery),
      context.queryClient.ensureQueryData(companiesQuery),
      context.queryClient.ensureQueryData(carriersQuery),
    ]),
  component: Accounting,
});

function Accounting() {
  const { isFinance } = useRouteContext({ from: "/_authenticated" });
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
  const [attaching, setAttaching] = useState<SyncRow | null>(null);
  const qbStatusFn = useServerFn(qbStatus);
  const qbStart = useServerFn(qbStartConnect);
  const qbOff = useServerFn(qbDisconnect);
  const qbSync = useServerFn(qbSyncNow);
  const { data: qbs, refetch: refetchQb } = useQuery({ queryKey: ["qb_status"], queryFn: () => qbStatusFn() });
  const [syncing, setSyncing] = useState(false);
  const [reconOpen, setReconOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const search = Route.useSearch();
  const [q, setQ] = useState(search.q ?? "");
  const [reviewOnly, setReviewOnly] = useState(!!search.review);
  const [range, setRange] = useState<RangeKey>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Lookups by id (thousands of companies) so each keystroke doesn't rescan every list.
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const carrierById = useMemo(() => new Map(carriers.map((c) => [c.id, c])), [carriers]);
  const loadById = useMemo(() => new Map(loads.map((l) => [l.id, l])), [loads]);
  const synced = (id: string, kind: string) => sync.find((s) => s.load_id === id && s.kind === kind);
  const delivered = loads.filter((l) => ["delivered", "invoiced"].includes(l.status));
  // Each load sits under the company that bills it: its existing invoice's company, else the default
  // (our own trucks → Foust Farms, outside carriers → Clearwater). Staff can bill through either company.
  const billedKind = (l: Load) => sync.find((s) => s.load_id === l.id && s.kind !== "bill")?.kind ?? invoiceKind(l);
  const ar = delivered.filter((l) => billedKind(l) === "invoice");
  const fleetAr = delivered.filter((l) => billedKind(l) === "fleet_invoice");
  const ap = loads.filter((l) => l.carrier_id && l.pod_received && ["delivered", "invoiced", "paid"].includes(l.status));
  const ap0 = ap.filter((l) => !isFleetLoad(l));
  const [batchOpen, setBatchOpen] = useState(false);
  const needsReview = (l: Load) => qbReviewState(l, sync) !== null;
  // Arriving from the "invoiced loads to review" notice: show only those, on the tab that holds them.
  useEffect(() => {
    if (search.q !== undefined) setQ(search.q);
    if (!search.review) return;
    setReviewOnly(true);
    setRange("all"); setFrom(""); setTo(""); setPicked([]);
    const hit = (list: Load[]) => list.some((l) => needsReview(l) && (!search.q || l.load_number === search.q));
    setTab(hit(ar) ? "invoice" : hit(fleetAr) ? "fleet_invoice" : "invoice");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.q, search.review]);
  const tabRows = tab === "invoice" ? ar : tab === "fleet_invoice" ? fleetAr : ap0;
  const rows = reviewOnly && tab !== "bill" ? tabRows.filter(needsReview) : tabRows;
  const carrierOf = (l: Load) => carrierById.get(l.carrier_id ?? "");
  // Search box: load #, ITS #, invoice #, customer/carrier, lane, refs. Filters on a deferred copy so typing stays instant.
  const needle = useDeferredValue(q).trim().toLowerCase();
  const hayById = useMemo(() => {
    const inv = new Map<string, string[]>();
    for (const x of sync) if (x.invoice_number) inv.set(x.load_id, [...(inv.get(x.load_id) ?? []), x.invoice_number]);
    return new Map(loads.map((l) => [l.id, [l.load_number, l.external_ref, l.ship_ref, l.dest_ref, l.customer_ref, l.origin_city, l.origin_state, l.dest_city, l.dest_state,
      companyById.get(l.customer_id ?? "")?.name, carrierById.get(l.carrier_id ?? "")?.legal_name, (inv.get(l.id) ?? []).join(" ")].join(" ").toLowerCase()]));
  }, [loads, sync, companyById, carrierById]);
  // Date range: loads by delivery (else pickup) date; sync rows by their load's date, else queued date.
  const inRange = (d?: string | null) => { if (!from && !to) return true; if (!d) return false; const day = d.slice(0, 10); return (!from || day >= from) && (!to || day <= to); };
  const loadDay = (l?: Load) => l ? (l.delivery_at ?? l.pickup_at) : null;
  const rowsR = rows.filter((l) => inRange(loadDay(l)));
  const syncR = sync.filter((x) => inRange(loadDay(loadById.get(x.load_id)) ?? x.created_at));
  const shown = needle ? rowsR.filter((l) => (hayById.get(l.id) ?? "").includes(needle)) : rowsR;
  // Draw the first rows only; "Show more" adds the rest so long lists stay quick.
  const [limit, setLimit] = useState(200);
  useEffect(() => { setLimit(200); }, [needle, tab, from, to, reviewOnly]);
  const shownSync = needle ? syncR.filter((x) => `${x.invoice_number ?? ""} ${x.payee ?? ""} ${hayById.get(x.load_id) ?? ""}`.toLowerCase().includes(needle)) : syncR;
  /** Carrier bill math: rate con total minus the Quick Pay fee for the load's pay terms. */
  const billMath = (l: Load) => {
    const gross = loadTotals(l).cost;
    const pt = effectivePayTerms(l, carrierOf(l));
    const fee = Math.round(gross * pt.fee * 100) / 100;
    return { gross, fee, net: gross - fee, pt };
  };
  const amountFor = (l: Load, kind: Kind) => (kind === "bill" ? billMath(l).net : loadTotals(l).revenue);
  const viewer = useBlobViewer();
  const groupOf = (s: SyncRow) => sync.filter((x) => x.invoice_number && x.invoice_number === s.invoice_number && x.kind === s.kind);
  const invoiceTerms = (s: SyncRow) => s.terms ?? companyById.get(loadById.get(s.load_id)?.customer_id ?? "")?.pay_terms ?? "Net 30";
  const dueOf = (s: SyncRow) => s.due_date ?? new Date(new Date(s.created_at).getTime() + termsDays(invoiceTerms(s)) * 86_400_000).toISOString().slice(0, 10);
  const invoicePdf = async (s: SyncRow) => {
    const l = loads.find((x) => x.id === s.load_id);
    if (!l || !s.invoice_number) return null;
    const g = groupOf(s);
    const lines = g.map((x) => ({ load: loads.find((y) => y.id === x.load_id)!, amount: Number(x.amount), deductions: x.deductions })).filter((x) => x.load);
    const amount = g.length > 1 ? lines.reduce((t, x) => t + x.amount, 0) : Number(s.amount);
    const billTo = companies.find((c) => c.id === l.customer_id);
    const terms = invoiceTerms(s);
    return buildInvoicePdf({ invoiceNumber: s.invoice_number, terms, dueDate: dueOf(s), invoiceDate: s.created_at, load: l, billTo, amount, logo: await loadImage(logo.url), fleet: s.kind === "fleet_invoice", lines: g.length > 1 ? lines : undefined, deductions: s.deductions });
  };
  const viewInvoice = async (s: SyncRow) => { const d = await invoicePdf(s); if (d) viewer.show(d.output("blob"), `${s.invoice_number}.pdf`); };
  const emailInvoice = async (s: SyncRow) => {
    const l = loads.find((x) => x.id === s.load_id); const d = await invoicePdf(s);
    if (!l || !d) return;
    d.save(`${s.invoice_number}.pdf`);
    const g = groupOf(s);
    const nums = g.map((x) => loads.find((y) => y.id === x.load_id)?.load_number).filter(Boolean).join(", ");
    const amt = g.reduce((t, x) => t + owed(x), 0);
    const to = companies.find((c) => c.id === l.customer_id)?.email ?? "";
    await composeEmail(to, `Invoice ${s.invoice_number} — ${g.length > 1 ? `${g.length} loads` : `Load ${l.load_number}`} — ${s.kind === "fleet_invoice" ? "Foust Farms Truckin" : "Clearwater Cargo"}`,
      `Hello,\n\nPlease find invoice ${s.invoice_number} for ${g.length > 1 ? `loads ${nums}` : `load ${l.load_number} (${l.origin_city}, ${l.origin_state} to ${l.dest_city}, ${l.dest_state})`} attached. Amount due: ${usd(amt)}, ${invoiceTerms(s)} (due ${new Date(dueOf(s) + "T12:00:00").toLocaleDateString("en-US")}).\n\nThank you,\n${s.kind === "fleet_invoice" ? "Foust Farms Truckin LLC · 336-622-9527" : "Clearwater Cargo LLC · 252-497-7916"}`, getMailClient());
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
    if (kind !== "bill") return companyById.get(l.customer_id ?? "")?.name ?? "Unknown customer";
    const c = carrierById.get(l.carrier_id ?? "");
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
    if (qbs?.brokerage.connected || qbs?.fleet.connected) syncNow();
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await qbSync({ data: {} });
      const att = r.attached || r.attachFailed ? ` · ${r.attached} file(s) attached${r.attachFailed ? `, ${r.attachFailed} file(s) failed` : ""}` : "";
      if (r.sent || r.failed || att) toast[r.failed || r.attachFailed ? "warning" : "success"](`${r.sent} sent to QuickBooks${r.failed ? `, ${r.failed} failed — see Sync log` : ""}${att}`);
      else toast.info("Nothing waiting to send.");
    } catch (e) { toast.error((e as Error).message); }
    setSyncing(false);
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };
  const connect = async (entity: "brokerage" | "fleet" = "brokerage") => {
    if (window.location.hostname !== "tms.clearwatercargo.com") {
      return toast.info("Connect QuickBooks from your live site (tms.clearwatercargo.com) — Intuit only allows that address.");
    }
    try { const { url } = await qbStart({ data: { entity } }); window.location.href = url; } catch (e) { toast.error((e as Error).message); }
  };
  const disconnect = async (entity: "brokerage" | "fleet" = "brokerage") => {
    if (!confirm(`Disconnect ${entity === "fleet" ? "Foust Farms" : "Clearwater Cargo"} QuickBooks? Nothing already sent is changed.`)) return;
    await qbOff({ data: { entity } }); refetchQb();
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
  const loadOf = (id: string) => loadById.get(id);
  const age = (s: SyncRow) => { const l = loadOf(s.load_id); return l ? ageDays(l) ?? 0 : 0; };
  const bucket = (list: SyncRow[]) => {
    const open = list.filter((s) => !paidStatus(loadOf(s.load_id)));
    const sum = (f: (a: number) => boolean) => open.filter((s) => f(age(s))).reduce((t, s) => t + owed(s), 0);
    return { total: sum(() => true), a: sum((a) => a <= 30), b: sum((a) => a > 30 && a <= 60), c: sum((a) => a > 60) };
  };
  const arB = bucket(sync.filter((s) => s.kind !== "bill"));
  const apB = bucket(sync.filter((s) => s.kind === "bill"));
  const qpRevenue = sync.filter((s) => s.kind === "bill").reduce((t, s) => t + Number(s.quickpay_fee || 0), 0);

  // Print / PDF / CSV of exactly what this tab shows (all matching rows, not just the first page).
  const TAB_TITLE: Record<string, string> = { invoice: "Customer invoices (AR)", fleet_invoice: "Fleet billing (AR) — Foust Farms", bill: "Carrier bills (AP)", log: "QuickBooks sync log" };
  const qbText = (s?: SyncRow) => (s ? `${s.status}${s.qb_ref ? ` · QB ${s.qb_ref}` : ""}` : "Not sent");
  const day = (d?: string | null) => (d ? dayText(d) : "");
  const exportSpec = (): ReportSpec => {
    const filters = [
      datesLine(tab === "log" ? "Load dates (or queued date)" : "Delivery dates", from, to) + (range !== "all" && range !== "custom" ? ` (${rangeOptions().find((o) => o.value === range)?.label ?? ""})` : ""),
      needle && `Search: "${q.trim()}"`,
      reviewOnly && tab !== "bill" && tab !== "log" && "Only invoiced loads not yet in QuickBooks",
    ].filter((x): x is string => !!x);
    const aging = (k: string, b: ReturnType<typeof bucket>): [string, string][] => [[`${k} open`, usd(b.total)], ["0–30 days", usd(b.a)], ["31–60 days", usd(b.b)], ["60+ days", usd(b.c)]];
    if (tab === "log") {
      return {
        title: TAB_TITLE.log!, filters,
        summary: [["Entries", String(shownSync.length)], ["Sent", String(shownSync.filter((s) => s.status === "sent").length)], ["Queued", String(shownSync.filter((s) => s.status === "queued").length)], ["Failed", String(shownSync.filter((s) => s.status === "error").length)]],
        head: ["Type", "Invoice #", "Load", "Payee / customer", "Amount", "Deductions", "Owed", "Status", "Queued", "Sent", "Error"],
        right: [4, 6],
        rows: shownSync.map((s) => [KIND_LABEL[s.kind] ?? s.kind, s.invoice_number ?? "", loadById.get(s.load_id)?.load_number ?? "", s.payee ?? "", usd(Number(s.amount)),
          parseDeductions(s.deductions).map((d) => `${d.label} ${d.pct}%`).join(", "), usd(owed(s)), qbText(s), day(s.created_at), day(s.sent_at), [s.error, s.attach_error && `Attachments: ${s.attach_error}`].filter(Boolean).join(" · ")]),
        total: ["Total", "", `${shownSync.length} entries`, "", usd(shownSync.reduce((t, s) => t + Number(s.amount), 0)), "", usd(shownSync.reduce((t, s) => t + owed(s), 0)), "", "", "", ""],
      };
    }
    const lane = (l: Load) => `${l.origin_city}, ${l.origin_state} → ${l.dest_city}, ${l.dest_state}`;
    const age = (l: Load) => { const a = ageDays(l); return a === null ? "" : `${a}d`; };
    if (tab === "bill") {
      const t = shown.reduce((a, l) => { const b = billMath(l); return { g: a.g + b.gross, f: a.f + b.fee, n: a.n + b.net }; }, { g: 0, f: 0, n: 0 });
      return {
        title: TAB_TITLE.bill!, filters, summary: [["Loads", String(shown.length)], ...aging("AP", apB)],
        head: ["Load", "Lane", "Pay to", "Delivered", "Age", "Carrier pay", "Quick Pay fee", "Net to pay", "Pay terms", "Carrier invoice", "QuickBooks"],
        right: [4, 5, 6, 7, 9],
        rows: shown.map((l) => { const b = billMath(l); const s = synced(l.id, "bill"); return [l.load_number, lane(l), payee(l, "bill"), day(l.delivery_at), age(l), usd(b.gross), b.fee ? usd(b.fee) : "", usd(b.net), b.pt.terms, s?.carrier_invoice_amount != null ? usd(Number(s.carrier_invoice_amount)) : "", qbText(s)]; }),
        total: ["Total", `${shown.length} loads`, "", "", "", usd(t.g), usd(t.f), usd(t.n), "", "", ""],
      };
    }
    const kind = tab as Kind;
    return {
      title: TAB_TITLE[kind]!, company: kind === "fleet_invoice" ? "fleet" : "brokerage", filters, summary: [["Loads", String(shown.length)], ...aging("AR", arB)],
      head: ["Load", "Customer ref #", "Lane", "Bill to", "Delivered", "Age", "Amount", "Invoice #", "QuickBooks"],
      right: [5, 6],
      rows: shown.map((l) => { const s = synced(l.id, kind); return [l.load_number, l.customer_ref ?? "", lane(l), payee(l, kind), day(l.delivery_at), age(l), usd(amountFor(l, kind)), s?.invoice_number ?? "", qbText(s)]; }),
      total: ["Total", "", `${shown.length} loads`, "", "", "", usd(shown.reduce((t, l) => t + amountFor(l, kind), 0)), "", ""],
    };
  };


  return (
    <div className="space-y-5 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold uppercase">Accounting</h1>
        <div className="flex flex-wrap gap-2">
          {(tab === "invoice" || tab === "fleet_invoice") && (
            <Button variant="outline" onClick={() => (picked.length ? setBatchOpen(true) : toast.info("Tick the delivered loads to invoice."))}><FileText className="mr-1 h-4 w-4" />Create invoices ({picked.length})</Button>
          )}
          {tab !== "log" && <Button onClick={send}><Send className="mr-1 h-4 w-4" />Send selected to QuickBooks</Button>}
        </div>
      </div>
      <BatchInvoiceDialog open={batchOpen} onOpenChange={setBatchOpen} loads={rows.filter((l) => picked.includes(l.id))} companies={companies} onDone={() => { setPicked([]); if (qbs?.brokerage.connected || qbs?.fleet.connected) syncNow(); }} />
      <div className="grid gap-3 md:grid-cols-2">
        {([["brokerage", "Clearwater Cargo", "Customer invoices (AR) and carrier bills (AP)"], ["fleet", "Foust Farms Trucking", "Fleet billing (FF- invoices)"]] as const).map(([ent, name, what]) => {
          const st = qbs?.[ent];
          return (
            <div key={ent} className={`flex flex-wrap items-center gap-2 rounded border p-3 text-sm ${st?.connected ? "border-primary/50 bg-primary/10" : "border-warning/50 bg-warning/10"}`}>
              <PlugZap className={`h-4 w-4 ${st?.connected ? "text-primary" : "text-warning"}`} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{name} QuickBooks</div>
                <div className="text-xs text-muted-foreground">{what} · {st?.connected ? `Connected${st.company ? ` — ${st.company}` : ""}` : "Not connected — items wait in the queue"}</div>
              </div>
              {isFinance && (st?.connected
                ? <Button size="sm" variant="ghost" onClick={() => disconnect(ent)}>Disconnect</Button>
                : <Button size="sm" onClick={() => connect(ent)}>Connect</Button>)}
            </div>
          );
        })}
      </div>
      {(qbs?.brokerage.connected || qbs?.fleet.connected) ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1 text-muted-foreground">Queued items go to the matching company's QuickBooks automatically.</span>
          <Button size="sm" onClick={() => syncNow()} disabled={syncing}><RotateCcw className="mr-1 h-3.5 w-3.5" />{syncing ? "Syncing…" : "Sync now"}</Button>
          {isFinance && <Button size="sm" variant="outline" onClick={() => setReconOpen(true)}>Match QuickBooks invoices</Button>}
          {isFinance && <Button size="sm" variant="outline" onClick={() => setAssistOpen(true)}>Review assistant</Button>}
          <QbReconcileDialog open={reconOpen} onOpenChange={setReconOpen} loads={loads} companies={companies} sync={sync} available={{ brokerage: !!qbs?.brokerage.connected, fleet: !!qbs?.fleet.connected }} />
          {assistOpen && <ReviewAssistantDialog open={assistOpen} onOpenChange={setAssistOpen} loads={loads} companies={companies} sync={sync} />}
        </div>
      ) : !isFinance && <p className="text-xs text-muted-foreground">An admin or accountant connects QuickBooks.</p>}
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
      <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-muted-foreground">Date range
        <Select value={range} onValueChange={(v) => { setRange(v as RangeKey); setPicked([]); const r = rangeFor(v as RangeKey); if (r) { setFrom(r[0]); setTo(r[1]); } }}>
          <SelectTrigger className="mt-1 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{rangeOptions().map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="text-xs text-muted-foreground">From<DatePicker className="mt-1" value={from} onChange={(v) => { setRange("custom"); setFrom(v); setPicked([]); }} /></label>
      <label className="text-xs text-muted-foreground">To<DatePicker className="mt-1" value={to} onChange={(v) => { setRange("custom"); setTo(v); setPicked([]); }} /></label>
      <div className="relative min-w-64 flex-1 max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search load #, invoice #, customer, carrier or city" value={q} onChange={(e) => { setQ(e.target.value); setPicked([]); }} />
      </div>
      {tab !== "bill" && tab !== "log" && (
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded border px-3 text-sm" title="Loads marked Invoiced whose invoice hasn't reached QuickBooks yet">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => { setReviewOnly(e.target.checked); setPicked([]); }} />
          Invoiced — not yet in QuickBooks
        </label>
      )}
      <ReportExport className="ml-auto" build={exportSpec} />
      </div>
      <div className="overflow-x-auto rounded-md border bg-card">
        {tab === "log" ? (
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Load</TableHead><TableHead>Payee / customer</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Queued</TableHead><TableHead className="w-24">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {shownSync.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{KIND_LABEL[s.kind] ?? s.kind}{s.invoice_number && <div className="text-[10px] text-gold">{s.invoice_number}</div>}{s.qb_class && <div className="text-[10px] text-muted-foreground">Class: {s.qb_class}</div>}</TableCell>
                  <TableCell>{loadById.get(s.load_id) ? <LoadQuickLook load={loadById.get(s.load_id)!} /> : "—"}</TableCell>
                  <TableCell>{s.payee}</TableCell>
                  <TableCell>{usd(owed(s))}{s.kind !== "bill" && parseDeductions(s.deductions).length > 0 && <div className="text-[10px] text-muted-foreground">of {usd(Number(s.amount))} · {parseDeductions(s.deductions).map((d) => `${d.label} ${d.pct}%`).join(", ")}</div>}</TableCell>
                  <TableCell>
                    <Pill status={s.status} />
                    {s.error && <div className="mt-1 max-w-56 text-[10px] text-destructive">{s.error}</div>}
                    {s.attach_error && <div className="mt-1 max-w-56 text-[10px] text-destructive">Attachments: {s.attach_error}</div>}
                  </TableCell>
                  <TableCell>{fmtDate(s.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {isFinance && <Button size="icon" variant="ghost" title="Edit invoice / terms" onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /></Button>}
                      <Button size="sm" variant="ghost" className="h-8 px-2" title="Attach documents for QuickBooks" onClick={() => setAttaching(s)}><Paperclip className="h-3.5 w-3.5" />{attachCount(s) > 0 && <span className="ml-0.5 text-[10px]">{attachCount(s)}</span>}</Button>
                      {s.status === "error" && <Button size="icon" variant="ghost" title="Retry" onClick={() => retry(s)}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                      {isFinance && <Button size="icon" variant="ghost" title="Remove from queue" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!shownSync.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{needle || from || to ? "No matches." : "Nothing sent yet."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input type="checkbox" checked={picked.length > 0 && picked.length === Math.min(shown.length, limit)} onChange={(e) => setPicked(e.target.checked ? shown.slice(0, limit).map((r) => r.id) : [])} />
                </TableHead>
                <TableHead>Load</TableHead><TableHead>Lane</TableHead><TableHead>{tab === "bill" ? "Pay to" : "Bill to"}</TableHead><TableHead>Delivered</TableHead><TableHead>Age</TableHead><TableHead>Amount</TableHead><TableHead>{tab === "bill" ? "Carrier invoice" : "Invoice"}</TableHead><TableHead>QuickBooks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.slice(0, limit).map((l) => {
                const s = synced(l.id, tab as Kind);
                const bm = tab === "bill" ? billMath(l) : null;
                const mismatch = s?.carrier_invoice_amount != null && bm && Math.abs(Number(s.carrier_invoice_amount) - bm.gross) > 0.009;
                const age = ageDays(l);
                return (
                  <TableRow key={l.id}>
                    <TableCell><input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} /></TableCell>
                    <TableCell><LoadQuickLook load={l} />{tab !== "bill" && billedKind(l) !== invoiceKind(l) && <div className="text-[10px] text-warning">Billed through {billedKind(l) === "fleet_invoice" ? "Foust Farms" : "Clearwater"}</div>}</TableCell>
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
                        {s && isFinance && <Button size="icon" variant="ghost" title="Edit invoice / terms" onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /></Button>}
                        {s && <Button size="sm" variant="ghost" className="h-8 px-2" title="Attach documents for QuickBooks" onClick={() => setAttaching(s)}><Paperclip className="h-3.5 w-3.5" />{attachCount(s) > 0 && <span className="ml-0.5 text-[10px]">{attachCount(s)}</span>}</Button>}
                        {s && s.status === "error" && <Button size="icon" variant="ghost" title="Retry" onClick={() => retry(s)}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                        {s && isFinance && <Button size="icon" variant="ghost" title="Remove from queue" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                      </div>
                      {s?.attach_error && <div className="mt-1 max-w-56 text-[10px] text-destructive">Attachments: {s.attach_error}</div>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {shown.length > limit && <TableRow><TableCell colSpan={9} className="text-center"><Button size="sm" variant="outline" onClick={() => setLimit((n) => n + 200)}>Show more ({shown.length - limit} more)</Button></TableCell></TableRow>}
              {!shown.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">{(needle || from || to) && rows.length ? "No matches." : reviewOnly && tab !== "bill" ? "No invoiced loads waiting for QuickBooks here." : tab === "bill" ? "No loads with a signed POD yet." : tab === "fleet_invoice" ? "No delivered loads billed by Foust Farms." : "No delivered loads to invoice."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </div>
      {viewer.viewer}
      <EditSyncDialog row={editing} groupSize={editing ? groupOf(editing).length : 1} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["qb_sync"] }); }} />
      <QbAttachDialog row={attaching} loads={attaching ? (attaching.kind !== "bill" ? groupOf(attaching) : [attaching]).map((x) => loads.find((l) => l.id === x.load_id)).filter((l): l is Load => !!l) : []}
        onClose={() => setAttaching(null)} onSaved={() => { setAttaching(null); qc.invalidateQueries({ queryKey: ["qb_sync"] }); }} />
    </div>
  );
}

function EditSyncDialog({ row, groupSize = 1, onClose, onSaved }: { row: SyncRow | null; groupSize?: number; onClose: () => void; onSaved: () => void }) {
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [terms, setTerms] = useState("");
  const [due, setDue] = useState("");
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [deds, setDeds] = useState<Deduction[]>([]);
  const [dLabel, setDLabel] = useState<string>(DEDUCTION_PRESETS[0] ?? "QuickPay fee");
  const [dOther, setDOther] = useState("");
  const [dPct, setDPct] = useState("");
  const [kind, setKind] = useState("invoice");
  const isInvoice = row?.kind !== "bill";
  const locked = !!row && (row.status === "sent" || !!row.qb_ref);
  const companyName = (k?: string | null) => (k === "fleet_invoice" ? "Foust Farms" : "Clearwater Cargo");
  if (row && openFor !== row.id) {
    setOpenFor(row.id);
    setPayee(row.payee ?? "");
    setAmount(String(row.amount));
    setTerms(row.terms ?? "");
    setDue(row.due_date ?? "");
    setDeds(parseDeductions(row.deductions));
    setKind(row.kind);
  }
  const addDed = () => {
    const pct = Number(dPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return toast.error("Enter a percentage between 0 and 100.");
    const label: string = dLabel === "Other" ? dOther.trim() || "Deduction" : (dLabel ?? "Deduction");
    setDeds([...deds, { label, pct }]); setDPct(""); setDOther("");
  };
  const fmtDeds = (v: unknown) => parseDeductions(v).map((d) => `${d.label} ${d.pct}%`).join(", ") || "None";
  const pickTerms = (t: string) => {
    setTerms(t);
    if (row && t) setDue(new Date(new Date(row.created_at).getTime() + termsDays(t) * 86_400_000).toISOString().slice(0, 10));
  };

  const { ask, dialog } = useReviewChanges();
  const save = async () => {
    if (!row) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return toast.error("Enter a valid amount.");
    const changes = diff([
      { label: "Payee / customer", before: row.payee, after: payee.trim() },
      { label: "Amount", before: row.amount, after: amt },
      ...(isInvoice ? [{ label: "Bill through", before: companyName(row.kind), after: companyName(kind) }, { label: "Payment terms", before: row.terms, after: terms }, { label: "Due date", before: row.due_date, after: due }, { label: "Deductions", before: fmtDeds(row.deductions), after: fmtDeds(deds) }] : []),
    ]);
    if (!changes.length) return toast.info("No changes to save.");
    if (!(await ask(changes))) return;
    if (isInvoice && kind !== row.kind) {
      const { data: num, error: kErr } = await supabase.rpc("set_invoice_company", { p_id: row.id, p_kind: kind });
      if (kErr) return toast.error(kErr.message);
      toast.success(`Now billed through ${companyName(kind)} as ${num}.`);
    }
    const patch = { payee: payee.trim() || null, amount: amt, ...(isInvoice ? { terms: terms || null, due_date: due || null, deductions: deds } : {}) };
    const { error } = await supabase.from("qb_sync").update(patch).eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Updated.");
    onSaved();
  };

  return (
    <Dialog open={!!row} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        {dialog}
        <DialogHeader><DialogTitle>Edit {isInvoice ? `invoice ${row?.invoice_number ?? ""}` : "bill"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs text-muted-foreground">Payee / customer
            <Input className="mt-1" value={payee} onChange={(e) => setPayee(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">Amount
            <Input className="mt-1" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          {isInvoice && <>
            <label className="block text-xs text-muted-foreground">Bill the customer through
              <select className="mt-1 h-9 w-full rounded border bg-background px-2 text-sm text-foreground disabled:opacity-60" value={kind} disabled={locked} onChange={(e) => setKind(e.target.value)}>
                <option value="invoice">Clearwater Cargo (INV-, Clearwater QuickBooks)</option>
                <option value="fleet_invoice">Foust Farms (FF-, Foust QuickBooks)</option>
              </select>
              {locked ? <span className="mt-1 block text-[10px]">Already in QuickBooks — the company can't change now.</span>
                : kind !== row?.kind && <span className="mt-1 block text-[10px] text-warning">Gets a new {kind === "fleet_invoice" ? "FF-" : "INV-"} invoice number{groupSize > 1 ? ` (all ${groupSize} loads on this combined invoice move together)` : ""}. Re-send the PDF if the customer already has the old one.</span>}
            </label>
            <label className="block text-xs text-muted-foreground">Payment terms
              <select className="mt-1 h-9 w-full rounded border bg-background px-2 text-sm text-foreground" value={terms} onChange={(e) => pickTerms(e.target.value)}>
                <option value="">Customer default</option>
                {CUSTOMER_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">Due date
              <Input className="mt-1" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <div className="rounded border p-2 text-xs">
              <div className="mb-1 text-muted-foreground">Percentage deductions (taken off what the customer owes)</div>
              {deds.map((d, i) => (
                <div key={i} className="flex items-center justify-between py-0.5">
                  <span>{d.label} · {d.pct}% <span className="text-muted-foreground">(−{usd((Number(amount) || 0) * d.pct / 100)})</span></span>
                  <button className="text-destructive" onClick={() => setDeds(deds.filter((_, j) => j !== i))}>remove</button>
                </div>
              ))}
              <div className="mt-1 flex gap-1">
                <select className="h-8 flex-1 rounded border bg-background px-1 text-foreground" value={dLabel} onChange={(e) => setDLabel(e.target.value)}>
                  {DEDUCTION_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <Input className="h-8 w-16" type="number" min="0" max="100" step="0.1" placeholder="%" value={dPct} onChange={(e) => setDPct(e.target.value)} />
                <Button size="sm" variant="secondary" onClick={addDed}>Add</Button>
              </div>
              {dLabel === "Other" && <Input className="mt-1 h-8" placeholder="Deduction name" value={dOther} onChange={(e) => setDOther(e.target.value)} />}
              <div className="mt-2 flex justify-between font-semibold"><span>Customer owes</span><span className="text-gold">{usd(invoiceNet(Number(amount) || 0, deds))}</span></div>
            </div>
          </>}
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
