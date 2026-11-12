import { useReviewChanges, diff } from "@/components/ReviewChanges";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { qbReviewState } from "@/lib/invoiceReview";
import { DatePicker } from "@/components/DatePicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rangeFor, rangeOptions, type RangeKey } from "@/lib/dateRanges";
import { toast } from "sonner";
import { Send, PlugZap, Pencil, Trash2, RotateCcw, Search, Paperclip, Link2 } from "lucide-react";
import { QbManualLinkDialog } from "@/components/QbManualLinkDialog";
import { QbAttachDialog } from "@/components/QbAttachDialog";
import { parseAttachments } from "@/lib/qbAttachments";
import { supabase } from "@/integrations/supabase/client";
import { carriersQuery, companiesQuery, loadsQuery, fetchAllPaged } from "@/lib/queries";
import { agingTotal, carrierAccountingEntries } from "@/lib/accountingSummary";
import { accountingBulkPatch, checkedAccountingRows, uniqueAccountingInvoices } from "@/lib/accountingBulk";
import { CUSTOMER_TERMS, termsDays, effectiveFeeRate, effectivePayTerms, fmtDate, isFleetLoad, loadTotals, usd, type Accessorial, type Load } from "@/lib/tms";
import { BatchInvoiceDialog } from "@/components/BatchInvoiceDialog";
import { invoiceKind } from "@/lib/batchInvoice";
import { useAppWindows } from "@/lib/appWindows";
import { ReportExport } from "@/components/ReportExport";
import { datesLine, dayText, downloadReportCsv, type ReportSpec } from "@/lib/reportExport";
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
import { ActionButton, Hint, useConfirm, type ConfirmSpec } from "@/components/ActionGuard";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar, SelectAllBox, useSelection, type BulkAction } from "@/components/BulkActionBar";
import { buildLoadListActions } from "@/components/LoadListBar";
import { Files, ClipboardCheck, Landmark } from "lucide-react";
import { InvoicePacketDialog, buildPacketBlob, listPacketDocs, saveBlob } from "@/components/InvoicePacket";
import { packetDefault } from "@/lib/invoicePacket";
import { CarrierInvoiceDialog, type BillTarget } from "@/components/CarrierInvoiceDialog";
import { BillAuditDialog } from "@/components/BillAuditDialog";
import { FactoringRemittanceDialog } from "@/components/FactoringRemittanceDialog";
import { QbAuditDialog } from "@/components/QbAuditDialog";
import { QbPaidDialog } from "@/components/QbPaidDialog";
import { auditBill, parseChargeLines } from "@/lib/billAudit";
import type { PayCarrier } from "@/lib/carrierPay";

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
  carrier_invoice_number?: string | null;
  carrier_invoice_lines?: unknown;
  terms?: string | null;
  due_date?: string | null;
  attachments?: unknown;
  attachments_sent?: unknown;
  attach_on_send?: boolean;
  attach_error?: string | null;
};
const attachCount = (s: SyncRow) => parseAttachments(s.attachments).length;
type Kind = "invoice" | "fleet_invoice" | "bill";
const HINT = {
  edit: "Change the payee, amount, terms, due date, deductions or billing company. You review the changes before they save.",
  attach: "Pick POD, BOL or other load files to send to QuickBooks with this invoice or bill.",
  retry: "This failed to send. Puts it back in the queue to try again.",
  remove: "Removes this entry from the TMS queue. Asks you first; does not delete anything in QuickBooks.",
};
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
  const { data: loads } = useSuspenseQuery({ ...loadsQuery, refetchInterval: 60_000 });
  const { data: companies } = useSuspenseQuery(companiesQuery);
  const { data: carriers } = useSuspenseQuery({ ...carriersQuery, refetchInterval: 60_000 });
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: sync = [], error: syncError, isFetching: refreshing } = useQuery({
    queryKey: ["qb_sync"],
    queryFn: async () => (await fetchAllPaged("qb_sync", "created_at", false)) as SyncRow[],
    refetchInterval: 60_000,
  });
  const [summaryOpen, setSummaryOpen] = useState<"ar" | "ap" | "fees" | null>(null);
  const refreshAccounting = async () => {
    await Promise.all(["loads", "carriers", "qb_sync"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
  };
  const [tab, setTab] = useState<Kind | "log">("invoice");
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<SyncRow | null>(null);
  const [attaching, setAttaching] = useState<SyncRow | null>(null);
  const [linking, setLinking] = useState<SyncRow | null>(null);
  type ReviewAction = "edit" | "attach" | "link" | "email" | "packet" | "carrier";
  const [reviewQueue, setReviewQueue] = useState<{ action: ReviewAction; rows: Load[]; entries: SyncRow[]; index: number } | null>(null);
  const qbStatusFn = useServerFn(qbStatus);
  const qbStart = useServerFn(qbStartConnect);
  const qbOff = useServerFn(qbDisconnect);
  const qbSync = useServerFn(qbSyncNow);
  const { data: qbs, refetch: refetchQb } = useQuery({ queryKey: ["qb_status"], queryFn: () => qbStatusFn() });
  const [syncing, setSyncing] = useState(false);
  const { openWindow } = useAppWindows();
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
  const carrierEntries = carrierAccountingEntries(loads, carrierById, new Set(sync.filter((s) => s.kind !== "bill").map((s) => s.load_id)));
  const ap0 = carrierEntries.filter((e) => e.owed).map((e) => e.load);
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
    const rate = effectiveFeeRate(l, carrierOf(l));
    const fee = Math.round(gross * rate * 100) / 100;
    return { gross, fee, net: gross - fee, pt, rate };
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
    const lines = g.flatMap((x) => { const load = loadById.get(x.load_id); return load ? [{ load, amount: Number(x.amount), deductions: x.deductions }] : []; });
    const amount = g.length > 1 ? lines.reduce((t, x) => t + x.amount, 0) : Number(s.amount);
    const billTo = companies.find((c) => c.id === l.customer_id);
    const terms = invoiceTerms(s);
    return buildInvoicePdf({ invoiceNumber: s.invoice_number, terms, dueDate: dueOf(s), invoiceDate: s.created_at, load: l, billTo, amount, logo: await loadImage(logo.url), fleet: s.kind === "fleet_invoice", lines: g.length > 1 ? lines : undefined, deductions: s.deductions });
  };
  const viewInvoice = async (s: SyncRow) => { const d = await invoicePdf(s); if (d) viewer.show(d.output("blob"), `${s.invoice_number}.pdf`); };
  /** Downloads the invoice (or a ready packet) and opens an email to the customer in the user's Gmail. */
  const emailInvoice = async (s: SyncRow, file?: { blob: Blob; name: string }) => {
    const l = loads.find((x) => x.id === s.load_id);
    if (!l) return;
    if (file) saveBlob(file.blob, file.name);
    else { const d = await invoicePdf(s); if (!d) return; d.save(`${s.invoice_number}.pdf`); }
    const g = groupOf(s);
    const nums = g.map((x) => loads.find((y) => y.id === x.load_id)?.load_number).filter(Boolean).join(", ");
    const amt = g.reduce((t, x) => t + owed(x), 0);
    const to = companies.find((c) => c.id === l.customer_id)?.email ?? "";
    await composeEmail(to, `Invoice ${s.invoice_number} — ${g.length > 1 ? `${g.length} loads` : `Load ${l.load_number}`} — ${s.kind === "fleet_invoice" ? "Foust Farms Truckin" : "Clearwater Cargo"}`,
      `Hello,\n\nPlease find invoice ${s.invoice_number}${file ? " with proof of delivery" : ""} for ${g.length > 1 ? `loads ${nums}` : `load ${l.load_number} (${l.origin_city}, ${l.origin_state} to ${l.dest_city}, ${l.dest_state})`} attached. Amount due: ${usd(amt)}, ${invoiceTerms(s)} (due ${new Date(dueOf(s) + "T12:00:00").toLocaleDateString("en-US")}).\n\nThank you,\n${s.kind === "fleet_invoice" ? "Foust Farms Truckin LLC · 336-622-9527" : "Clearwater Cargo LLC · 252-497-7916"}`, getMailClient());
    toast.success(`${file ? "Invoice packet" : "Invoice PDF"} downloaded and email started — attach the PDF.`);
  };
  const [packetRow, setPacketRow] = useState<SyncRow | null>(null);
  const [packing, setPacking] = useState(false);
  /** One packet per invoice for the ticked loads, with the default documents (POD + BOL). */
  const downloadPackets = async () => {
    const kind = tab as Kind;
    const rowsFor = uniqueAccountingInvoices(checkedAccountingRows(shown, picked).map((l) => synced(l.id, kind)).filter((s): s is SyncRow => !!s?.invoice_number));
    if (!rowsFor.length) return toast.info("Tick loads that already have an invoice number.");
    setPacking(true);
    let made = 0;
    for (const s of rowsFor) {
      try {
        const inv = await invoicePdf(s);
        if (!inv) continue;
        const docs = (await listPacketDocs(groupOf(s).map((x) => loadById.get(x.load_id)).filter((x): x is Load => !!x))).filter((d) => packetDefault(d.kind));
        const r = await buildPacketBlob(inv, docs);
        saveBlob(r.blob, `${s.invoice_number}-packet.pdf`); made++;
      } catch (e) { toast.error(`${s.invoice_number}: ${(e as Error).message}`); }
    }
    setPacking(false);
    toast.success(`${made} invoice packet${made === 1 ? "" : "s"} downloaded`);
  };
  const [billTarget, setBillTarget] = useState<BillTarget | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [factorOpen, setFactorOpen] = useState(false);
  const [qbAuditOpen, setQbAuditOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const billTargetFor = (l: Load): BillTarget => { const b = billMath(l); return { load: l, bill: synced(l.id, "bill"), payee: payee(l, "bill"), net: b.net, gross: b.gross, fee: b.fee }; };
  const invoicedIds = useMemo(() => new Set(sync.filter((s) => s.kind !== "bill").map((s) => s.load_id)), [sync]);

  const payee = (l: Load, kind: string) => {
    if (kind !== "bill") return companyById.get(l.customer_id ?? "")?.name ?? "Unknown customer";
    const c = carrierById.get(l.carrier_id ?? "");
    return c?.factoring_company ? `${c.factoring_company} (for ${c.legal_name})` : c?.legal_name ?? "Unknown carrier";
  };

  const ageDays = (l: Load) => (l.delivery_at ? Math.max(0, Math.floor((Date.now() - new Date(l.delivery_at).getTime()) / 86400_000)) : null);
  const kindCompany = (k: string) => (k === "fleet_invoice" ? "Foust Farms" : "Clearwater Cargo");
  const live = (k: string) => !!(k === "fleet_invoice" ? qbs?.fleet.connected : qbs?.brokerage.connected);

  /** Warning box for "Send selected to QuickBooks". */
  const sendSpec = (): ConfirmSpec | null => {
    const chosen = checkedAccountingRows(shown, picked);
    if (!chosen.length) return null;
    const kind = tab as Kind;
    const bill = kind === "bill";
    const total = chosen.reduce((t, l) => t + amountFor(l, kind), 0);
    const dlv = chosen.filter((l) => l.status === "delivered").length;
    const inQb = chosen.filter((l) => synced(l.id, kind)?.qb_ref).length;
    const off = bill ? chosen.filter((l) => { const s = synced(l.id, "bill"); return s?.carrier_invoice_amount != null && Math.abs(Number(s.carrier_invoice_amount) - billMath(l).gross) > 0.009; }).length : 0;
    const noInv = bill ? chosen.filter((l) => !synced(l.id, "bill")?.carrier_invoice_path).length : 0;
    return {
      title: `Send ${chosen.length} ${bill ? "carrier bill" : "customer invoice"}${chosen.length === 1 ? "" : "s"} to QuickBooks?`,
      body: `Total ${usd(total)} to ${kindCompany(kind)} QuickBooks.`,
      points: [
        live(kind) ? `Sends right away. QuickBooks gets a new ${bill ? "bill" : "invoice"} for each one, unless it already has one with the same number.` : `${kindCompany(kind)} QuickBooks isn't connected, so these wait in the queue until it is.`,
        !bill && dlv ? `${dlv} delivered load${dlv === 1 ? "" : "s"} will change to Invoiced.` : null,
        inQb ? `${inQb} already in QuickBooks — those are not sent again.` : null,
        off ? `Warning: ${off} carrier invoice${off === 1 ? "" : "s"} don't match the rate con. QuickBooks gets the rate con amount — check Bill audit first.` : null,
        noInv ? `${noInv} ha${noInv === 1 ? "s" : "ve"} no carrier invoice attached.` : null,
        bill ? "Bill amount = rate con total minus any Quick Pay fee. This does not pay the carrier or mark it paid." : "The customer is not emailed. Use the envelope button to email the invoice.",
      ].filter(Boolean),
      confirmLabel: "Send to QuickBooks",
    };
  };

  const send = async () => {
    const chosen = checkedAccountingRows(shown, picked);
    if (!chosen.length) return toast.info("Select at least one load.");
    const kind = tab as Kind;
    const unsent = chosen.filter((l) => !synced(l.id, kind)?.qb_ref);
    if (!unsent.length) return toast.info("All checked entries are already linked to QuickBooks; nothing was sent again.");
    const { error } = await supabase.from("qb_sync").upsert(
      unsent.map((l) => ({
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
    toast.success(`${unsent.length} ${kind === "bill" ? "bill(s)" : "invoice(s)"} queued for QuickBooks`);
    setPicked([]);
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
    if (qbs?.brokerage.connected || qbs?.fleet.connected) syncNow();
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await qbSync({ data: {} });
      const att = r.attached || r.attachFailed ? ` · ${r.attached} file(s) attached${r.attachFailed ? `, ${r.attachFailed} file(s) failed` : ""}` : "";
      if (r.linked?.length) toast.info(`Linked to invoices already in QuickBooks (no doubles made): ${r.linked.join("; ")}`, { duration: 12000 });
      if (r.sent || r.failed || att) toast[r.failed || r.attachFailed ? "warning" : "success"](`${r.sent} sent to QuickBooks${r.failed ? `, ${r.failed} failed — see Sync log` : ""}${att}`);
      else toast.info("Nothing waiting to send.");
    } catch (e) { toast.error((e as Error).message); }
    setSyncing(false);
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };
  const sendAnyway = async (id: string) => {
    try {
      const r = await qbSync({ data: { ids: [id], force: true } });
      toast[r.failed ? "warning" : "success"](r.failed ? "Still couldn't send — see the error." : "Sent to QuickBooks.");
    } catch (e) { toast.error((e as Error).message); }
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };
  const connect = async (entity: "brokerage" | "fleet" = "brokerage") => {
    if (window.location.hostname !== "tms.clearwatercargo.com") {
      return toast.info("Connect QuickBooks from your live site (tms.clearwatercargo.com) — Intuit only allows that address.");
    }
    try { const { url } = await qbStart({ data: { entity } }); window.location.href = url; } catch (e) { toast.error((e as Error).message); }
  };
  const disconnect = async (entity: "brokerage" | "fleet" = "brokerage") => {
    await qbOff({ data: { entity } }); refetchQb();
  };
  const disconnectSpec = (entity: "brokerage" | "fleet"): ConfirmSpec => ({
    title: `Disconnect ${entity === "fleet" ? "Foust Farms" : "Clearwater Cargo"} QuickBooks?`,
    points: ["The TMS stops sending invoices and bills to this QuickBooks company.", "Anything already in QuickBooks stays there, unchanged.", "New items wait in the queue until someone connects again."],
    confirmLabel: "Disconnect", danger: true,
  });

  const remove = async (s: SyncRow) => {
    const { error } = await supabase.from("qb_sync").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Removed from the queue.");
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };
  const removeSpec = (s: SyncRow): ConfirmSpec => ({
    title: `Remove this ${s.kind === "bill" ? "carrier bill" : `invoice${s.invoice_number ? ` ${s.invoice_number}` : ""}`} from the TMS?`,
    points: [
      s.qb_ref ? "It's already in QuickBooks — removing it here does NOT delete it in QuickBooks. Delete or void it there if needed." : "It hasn't reached QuickBooks, so it will not be sent.",
      "The load itself and its status are not changed.",
      s.kind !== "bill" ? "The load shows as needing an invoice again." : "The load shows as needing a bill again.",
    ],
    confirmLabel: "Remove", danger: true,
  });

  const retry = async (s: SyncRow) => {
    const { error } = await supabase.from("qb_sync").update({ status: "queued", error: null }).eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Queued again for sending.");
    qc.invalidateQueries({ queryKey: ["qb_sync"] });
  };
  const retrySpec = (s: SyncRow): ConfirmSpec => ({
    title: "Try sending this again?",
    body: s.error ? `Last error: ${s.error}` : undefined,
    points: ["Clears the error and puts it back in the queue.", `It goes to ${kindCompany(s.kind)} QuickBooks on the next sync (press Sync now to send it right away).`, "Fix the cause first (customer name, missing vendor, etc.) or it will fail again."],
    confirmLabel: "Queue again",
  });
  const logSel = useSelection();
  const logActions: BulkAction<SyncRow>[] = [
    { value: "retry", label: "Try again (failed only)", hint: "Puts the checked failed items back in the queue. Fix the cause first or they'll fail again.",
      points: (items) => [`${items.filter((x) => x.status === "error").length} failed item(s) go back in the queue; the rest are skipped.`, "They're sent on the next sync (or press Sync now)."],
      each: async (x) => {
        if (x.status !== "error") return `${x.invoice_number ?? x.payee ?? "Item"}: skipped — not failed`;
        const { error } = await supabase.from("qb_sync").update({ status: "queued", error: null }).eq("id", x.id);
        return error ? `${x.invoice_number ?? x.payee}: ${error.message}` : null;
      } },
    { value: "remove", label: "Remove from TMS queue", financeOnly: true, hint: "Removes the checked items from the TMS sync log (admin/accountant). Anything already in QuickBooks stays there.",
      points: (items) => [`${items.length} item(s) will be removed from the TMS.`, `${items.filter((x) => x.qb_ref).length} are already in QuickBooks — removing them here does NOT delete them in QuickBooks.`, "The loads and their statuses are not changed."],
      each: async (x) => { const { error } = await supabase.from("qb_sync").delete().eq("id", x.id); return error ? `${x.invoice_number ?? x.payee}: ${error.message}` : null; } },
  ];
  const queuedCount = sync.filter((s) => (s.status === "queued" || s.status === "error") && !s.qb_ref).length;
  const syncSpec = (): ConfirmSpec => ({
    title: "Sync with QuickBooks now?",
    points: [
      queuedCount ? `Sends ${queuedCount} waiting item${queuedCount === 1 ? "" : "s"} (queued or failed) to QuickBooks.` : "Nothing is waiting in the queue right now.",
      "Creates new invoices and bills in QuickBooks. If QuickBooks already has one with the same number, it's linked instead of duplicated.",
      "Uploads any documents you picked to attach. A POD already on the load is attached to its customer invoice automatically.",
      "Customers and carriers are not emailed.",
    ],
    confirmLabel: "Sync now",
  });

  const paidStatus = (l?: Load) => l?.status === "paid";
  const loadOf = (id: string) => loadById.get(id);
  const age = (s: SyncRow) => { const l = loadOf(s.load_id); return l ? ageDays(l) ?? 0 : 0; };
  const bucket = (list: SyncRow[]) => {
    const open = list.filter((s) => { const l = loadOf(s.load_id); return !!l && l.status !== "cancelled" && !paidStatus(l); });
    const sum = (f: (a: number) => boolean) => open.filter((s) => f(age(s))).reduce((t, s) => t + owed(s), 0);
    return { total: sum(() => true), a: sum((a) => a <= 30), b: sum((a) => a > 30 && a <= 60), c: sum((a) => a > 60) };
  };
  const filteredSync = shownSync.filter((s) => s.kind !== "bill");
  const arB = bucket(filteredSync);
  const filteredCarrier = carrierEntries.filter((e) => inRange(loadDay(e.load)) && (!needle || (hayById.get(e.load.id) ?? "").includes(needle)));
  const apEntries = filteredCarrier.filter((e) => e.owed);
  const apB = agingTotal(apEntries.map((e) => ({ amount: e.pay.net, age: Math.max(0, Math.floor((Date.now() - e.pay.podAt) / 86400_000)) })));
  const feeEntries = filteredCarrier.filter((e) => e.pay.fee > 0 && (e.owed || e.collected));
  const qpRevenue = feeEntries.filter((e) => e.collected).reduce((t, e) => t + e.pay.fee, 0);
  const qpPending = feeEntries.filter((e) => e.owed).reduce((t, e) => t + e.pay.fee, 0);
  const summaryRows = summaryOpen === "ar" ? filteredSync.filter((s) => {
    const l = loadOf(s.load_id); return !!l && !["paid", "cancelled"].includes(l.status);
  }).flatMap((s) => {
    const l = loadOf(s.load_id); return l ? [{ load: l, invoice: s.invoice_number ?? "—", payee: s.payee ?? "—", amount: owed(s), detail: `${kindCompany(s.kind)} · ${s.status}`, due: dueOf(s) }] : [];
  }) : (summaryOpen === "ap" ? apEntries : feeEntries).map((e) => ({
    load: e.load, invoice: sync.filter((s) => s.load_id === e.load.id && s.kind !== "bill").map((s) => s.invoice_number).filter(Boolean).join(", ") || "—",
    payee: payee(e.load, "bill"), amount: summaryOpen === "ap" ? e.pay.net : e.pay.fee,
    detail: summaryOpen === "ap" ? `${usd(e.pay.gross)} − ${usd(e.pay.fee)} (${Math.round(e.pay.rate * 1000) / 10}%)` : e.collected ? "Collected — carrier paid" : "Pending — carrier unpaid",
    due: new Date(e.pay.due).toISOString().slice(0, 10),
  }));
  const summaryTitle = summaryOpen === "ar" ? "Open customer receivables" : summaryOpen === "ap" ? "Unpaid carrier payables" : "Quick Pay fees — collected & pending";

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


  const selectedLoads = checkedAccountingRows(shown, picked);
  const showReview = (action: ReviewAction, load: Load, row?: SyncRow) => {
    if (action === "carrier") setBillTarget(billTargetFor(load));
    else if (!row) return;
    else if (action === "edit") setEditing(row);
    else if (action === "attach") setAttaching(row);
    else if (action === "link") setLinking(row);
    else if (action === "packet" || action === "email") setPacketRow(row);
  };
  const startReview = (action: ReviewAction, items: Load[], explicitRows?: SyncRow[]) => {
    const candidates = explicitRows ?? items.map((l) => synced(l.id, tab as Kind)).filter((s): s is SyncRow => !!s);
    const filtered = candidates.filter((s) =>
      (action !== "link" || s.kind !== "bill") &&
      (!["email", "packet"].includes(action) || (s.kind !== "bill" && !!s.invoice_number)) && !!loadById.get(s.load_id));
    const eligible = action === "edit" ? filtered : uniqueAccountingInvoices(filtered);
    const targets = action === "carrier" ? items : eligible.flatMap((s) => { const load = loadById.get(s.load_id); return load ? [load] : []; });
    if (!targets.length) { toast.info("No checked entries can use this action. Create or link an invoice first."); return; }
    if (action !== "carrier" && candidates.length < items.length) toast.info("Loads without an invoice are skipped; use Link existing QB invoice to match them.");
    setReviewQueue({ action, rows: targets, entries: eligible, index: 0 });
    const first = targets[0];
    if (first) showReview(action, first, eligible[0]);
  };
  const finishReview = () => { setReviewQueue(null); setEditing(null); setAttaching(null); setLinking(null); setPacketRow(null); setBillTarget(null); };
  const nextReview = () => {
    setEditing(null); setAttaching(null); setLinking(null); setPacketRow(null); setBillTarget(null);
    if (!reviewQueue) return;
    const index = reviewQueue.index + 1;
    const load = reviewQueue.rows[index];
    if (!load) { finishReview(); toast.success("Checked-entry review complete."); return; }
    setReviewQueue({ ...reviewQueue, index });
    const row = reviewQueue.entries[index];
    showReview(reviewQueue.action, load, row);
  };
  const commonEdits: BulkAction<SyncRow>[] = [
    ...(["payee", "amount", "due_date", "deductions"] as const).map((field): BulkAction<SyncRow> => ({
      value: `set-${field}`, label: field === "payee" ? "Set payee / customer" : field === "amount" ? "Set amount" : field === "due_date" ? "Set due date" : "Set customer QuickPay deduction %",
      financeOnly: true, input: { label: field === "payee" ? "Payee / customer name" : field === "amount" ? "Amount ($)" : field === "due_date" ? "Due date (YYYY-MM-DD)" : "Customer deduction % (0 removes)" },
      hint: "Applies the same value to all checked TMS entries. QuickBooks itself and carrier terms are unchanged.",
      points: (items, value) => [`Set ${field.replace(/_/g, " ")} to ${value} on ${items.length} checked entries.`, "Only TMS records change; invoices already in QuickBooks are NOT updated there.", field === "deductions" ? "Replaces customer percentage deductions. Carrier payment terms, fee choices and bank details stay unchanged." : "Other amounts, terms, deductions and carrier settings stay unchanged.", "Due dates and customer deductions skip carrier bills."],
      each: async (row, value) => {
        if (row.kind === "bill" && ["due_date", "deductions"].includes(field)) return `${row.invoice_number ?? row.id}: skipped — carrier bill`;
        const patch = accountingBulkPatch(field, value);
        const { error, count } = await supabase.from("qb_sync").update(patch, { count: "exact" }).eq("id", row.id);
        return error ? `${row.invoice_number ?? row.id}: ${error.message}` : !count ? `${row.invoice_number ?? row.id}: not allowed to update` : null;
      },
    })),
    { value: "terms", label: "Set customer payment terms", financeOnly: true, hint: "Applies the chosen terms and recalculates each invoice's due date from its own invoice date. Carrier terms stay unchanged.", param: { label: "Payment terms", options: CUSTOMER_TERMS.map((value) => ({ value, label: value })) }, points: (items, value) => [`${items.filter((s) => s.kind !== "bill").length} customer invoice entries get ${value}.`, "Due dates are recalculated from each invoice date. Carrier bills are skipped.", "Only TMS invoices change; QuickBooks invoices and carrier pay settings remain unchanged."], each: async (row, terms) => {
      if (row.kind === "bill") return `${row.id}: skipped — carrier bill`;
      const due_date = new Date(new Date(row.created_at).getTime() + termsDays(terms) * 86_400_000).toISOString().slice(0, 10);
      const { error, count } = await supabase.from("qb_sync").update({ terms, due_date }, { count: "exact" }).eq("id", row.id);
      return error ? `${row.invoice_number}: ${error.message}` : !count ? `${row.invoice_number}: not allowed to update` : null;
    } },
    { value: "company", label: "Set billing company (unsent only)", financeOnly: true, hint: "Moves each checked unsent customer invoice to the chosen billing company using the existing protected correction. Combined invoices move together and get a new number.", param: { label: "Billing company", options: [{ value: "invoice", label: "Clearwater Cargo" }, { value: "fleet_invoice", label: "Foust Farms" }] }, all: async (items, kind) => {
      const rows = uniqueAccountingInvoices(items.filter((s) => s.kind !== "bill" && !s.qb_ref && s.status !== "sent" && s.kind !== kind));
      if (!rows.length) { toast.info("No unsent checked invoices need to change company."); return; }
      if (!await confirm({ title: `Change billing company for ${rows.length} checked invoices?`, points: ["Combined invoices move together, including their other load lines.", "Each invoice receives a new invoice number. Old PDFs will need replacing.", "Invoices already in QuickBooks and carrier bills are skipped."], confirmLabel: "Change billing company" })) return;
      const errors: string[] = [];
      for (const row of rows) { const { error } = await supabase.rpc("set_invoice_company", { p_id: row.id, p_kind: kind }); if (error) errors.push(`${row.invoice_number}: ${error.message}`); }
      await refreshAccounting();
      if (errors.length) throw new Error(errors.join("; "));
      toast.success(`${rows.length} invoices changed billing company.`); setPicked([]); logSel.clear();
    } },
  ];
  const reviewActions: BulkAction<Load>[] = [
    ...buildLoadListActions({ actions: ["paid", "closeout", "paid_closeout", "status", "pod", "carrier_paid"] }),
    ...(tab === "bill" ? [{ value: "carrier", label: "Attach / review carrier invoices", financeOnly: true, hint: "Review the correct invoice and payment details separately for each checked load.", all: (items: Load[]) => startReview("carrier", items) }] : [
      { value: "create", label: "Create invoices", hint: "Create separate or combined invoices for the checked loads, with review before saving.", all: () => setBatchOpen(true) },
      { value: "packets", label: "Download invoice packets", hint: "Download one invoice, POD and BOL packet per checked invoice.", all: downloadPackets },
      { value: "packet", label: "Review invoice packets", hint: "Review documents for every checked invoice separately.", all: (items: Load[]) => startReview("packet", items) },
      { value: "email", label: "Email invoices (review each)", hint: "Review each invoice packet and open your Gmail; nothing is emailed automatically.", all: (items: Load[]) => startReview("email", items) },
      { value: "link", label: "Link existing QB invoices (review each)", financeOnly: true, hint: "Verify a separate existing QuickBooks invoice for each checked invoice; never assigns one invoice to unrelated loads.", all: (items: Load[]) => startReview("link", items) },
    ]),
    { value: "send", label: "Send to QuickBooks", hint: "Send the checked entries, retaining the existing duplicate and billing safeguards.", all: async () => { const spec = sendSpec(); if (spec && await confirm(spec)) await send(); } },
    { value: "edit", label: "Edit invoice / terms (review each)", financeOnly: true, hint: "Review amounts, terms, due dates, deductions and billing company separately for every checked entry.", all: (items) => startReview("edit", items) },
    { value: "attach", label: "Attach documents (review each)", hint: "Pick the correct documents for every checked invoice or bill; previously sent files are retained.", all: (items) => startReview("attach", items) },
    ...commonEdits.map((action): BulkAction<Load> => ({ ...action, points: (items, param) => action.points?.(items.flatMap((l) => { const s = synced(l.id, tab as Kind); return s ? [s] : []; }), param) ?? [], each: action.each ? async (l, param) => { const s = synced(l.id, tab as Kind); return s && action.each ? action.each(s, param) : `${l.load_number}: skipped — no invoice entry`; } : undefined, all: action.all ? (items, param) => action.all?.(items.flatMap((l) => { const s = synced(l.id, tab as Kind); return s ? [s] : []; }), param) : undefined })),
    ...logActions.map((action): BulkAction<Load> => ({ ...action, points: (items, param) => action.points?.(items.flatMap((l) => { const s = synced(l.id, tab as Kind); return s ? [s] : []; }), param) ?? [], each: async (l, param) => { const row = synced(l.id, tab as Kind); return row && action.each ? action.each(row, param) : `${l.load_number}: skipped — no queued entry`; }, all: undefined })),
    { value: "export", label: "Export checked to CSV", hint: "Download only the checked loads as a spreadsheet.", all: (items) => downloadReportCsv({ title: TAB_TITLE[tab] ?? "Accounting", head: ["Load", "Customer ref", "Payee", "Amount", "Invoice", "QuickBooks"], rows: items.map((l) => { const s = synced(l.id, tab as Kind); return [l.load_number, l.customer_ref ?? "", payee(l, tab), usd(amountFor(l, tab as Kind)), s?.invoice_number ?? "", qbText(s)]; }) }) },
  ];
  const logReviewActions: BulkAction<SyncRow>[] = [
    ...buildLoadListActions({ actions: ["paid", "closeout", "paid_closeout", "status", "pod", "carrier_paid"] }).map((action): BulkAction<SyncRow> => ({
      ...action,
      all: undefined,
      points: (items, param) => action.points?.([...new Set(items.map((s) => s.load_id))].flatMap((id) => { const l = loadById.get(id); return l ? [l] : []; }), param) ?? [],
      each: async (row, param) => {
        const checked = shownSync.filter((s) => logSel.has(s.id) && s.load_id === row.load_id);
        if (checked[0]?.id !== row.id) return `${row.invoice_number ?? row.id}: skipped — load already included by another checked entry`;
        const load = loadById.get(row.load_id);
        return load && action.each ? action.each(load, param) : `${row.invoice_number ?? row.id}: skipped — load not available`;
      },
    })),
    ...["edit", "attach", "link"].map((action): BulkAction<SyncRow> => ({ value: action, label: action === "edit" ? "Edit invoice / terms (review each)" : action === "attach" ? "Attach documents (review each)" : "Link existing QB invoices (review each)", financeOnly: action !== "attach", hint: "Review every checked invoice separately with its existing safeguards.", all: (items) => startReview(action as ReviewAction, items.flatMap((s) => { const l = loadById.get(s.load_id); return l ? [l] : []; }), items) })),
    ...logActions,
    ...commonEdits,
    { value: "force", label: "Send anyway (duplicate warnings only)", hint: "Creates new invoices despite duplicate warnings. Verify each is a different load first.", points: (items) => [`${items.filter((s) => s.status === "error" && s.error?.startsWith("Possible duplicate")).length} duplicate-warning entries will be sent as NEW invoices.`, "Only proceed if each warning refers to a different load; all other entries are skipped."], each: async (s) => { if (s.status !== "error" || !s.error?.startsWith("Possible duplicate")) return `${s.invoice_number ?? s.id}: skipped — no duplicate warning`; const result = await qbSync({ data: { ids: [s.id], force: true } }); return result.failed ? `${s.invoice_number ?? s.id}: still failed — see Sync log` : null; } },
  ];


  return (
    <div className="space-y-5 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold uppercase">Accounting</h1>
        <div className="flex flex-wrap gap-2">
          {isFinance && <ActionButton variant="outline" hint="Read existing QuickBooks invoices and manually link one to a TMS load that shows Not sent. Linking records the existing invoice without sending a duplicate." onClick={() => openWindow("qbMatch")}><Link2 className="mr-1 h-4 w-4" />Link existing QB invoice</ActionButton>}
          {isFinance && <ActionButton variant="outline" hint="Read-only: finds duplicate invoices in both QuickBooks companies, and checks an uploaded check stub or remittance against your QuickBooks invoices." onClick={() => setQbAuditOpen(true)}><ClipboardCheck className="mr-1 h-4 w-4" />QB duplicates & payments</ActionButton>}
          {isFinance && <ActionButton variant="outline" hint="Reads both QuickBooks companies for customer invoices paid in full, lists their loads, and lets you mark them Paid (optionally close out)." onClick={() => setPaidOpen(true)}><Landmark className="mr-1 h-4 w-4" />Customer paid in QB</ActionButton>}
          {(tab === "invoice" || tab === "fleet_invoice") && (
            <ActionButton variant="outline" hint="Opens a window to create invoice numbers for the ticked loads — one per load or one combined. You review it before anything is saved." onClick={() => (picked.length ? setBatchOpen(true) : toast.info("Tick the delivered loads to invoice."))}><FileText className="mr-1 h-4 w-4" />Create invoices ({picked.length})</ActionButton>
          )}
          {(tab === "invoice" || tab === "fleet_invoice") && (
            <ActionButton variant="outline" disabled={packing} hint="Downloads one invoice packet PDF (invoice + POD + BOL) per invoice for the ticked loads. Nothing is sent or changed." onClick={downloadPackets}><Files className="mr-1 h-4 w-4" />{packing ? "Building…" : `Invoice packets (${picked.length})`}</ActionButton>
          )}
          {tab === "bill" && <>
            <ActionButton variant="outline" hint="Compares every carrier invoice on this tab with its signed rate con: over/under billing, charges not on the rate con, missing invoices. Read-only." onClick={() => setAuditOpen(true)}><ClipboardCheck className="mr-1 h-4 w-4" />Bill audit</ActionButton>
            <ActionButton variant="outline" hint="Unpaid loads for factored carriers, grouped by factoring company, with the NOA remit-to address and a printable remittance schedule." onClick={() => setFactorOpen(true)}><Landmark className="mr-1 h-4 w-4" />Factoring remittance</ActionButton>
          </>}
          {tab !== "log" && <ActionButton hint={tab === "bill" ? "Queues the ticked carrier bills and sends them to Clearwater QuickBooks. Does not pay the carrier." : "Queues the ticked invoices, moves delivered loads to Invoiced, and sends them to QuickBooks. Asks you first."} confirm={sendSpec} onClick={send}><Send className="mr-1 h-4 w-4" />Send selected to QuickBooks</ActionButton>}
        </div>
      </div>
      <BatchInvoiceDialog open={batchOpen} onOpenChange={setBatchOpen} loads={selectedLoads} companies={companies} onDone={() => { setPicked([]); if (qbs?.brokerage.connected || qbs?.fleet.connected) syncNow(); }} />
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
                ? <ActionButton size="sm" variant="ghost" hint={`Stops the TMS from sending to ${name} QuickBooks. Nothing already in QuickBooks changes.`} confirm={disconnectSpec(ent)} onClick={() => disconnect(ent)}>Disconnect</ActionButton>
                : <ActionButton size="sm" hint={`Takes you to Intuit to sign in and link ${name} QuickBooks. Only works on tms.clearwatercargo.com.`}
                    confirm={() => window.location.hostname !== "tms.clearwatercargo.com" ? null : { title: `Connect ${name} QuickBooks?`, points: ["You'll leave the TMS to sign in to Intuit, then come back here.", `Queued ${ent === "fleet" ? "fleet invoices" : "invoices and carrier bills"} start sending to this company once connected.`], confirmLabel: "Go to Intuit" }}
                    onClick={() => connect(ent)}>Connect</ActionButton>)}
            </div>
          );
        })}
      </div>
      {(qbs?.brokerage.connected || qbs?.fleet.connected) ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1 text-muted-foreground">Queued items go to the matching company's QuickBooks automatically.</span>
          <ActionButton size="sm" hint="Sends everything waiting in the queue (and any failed items) to QuickBooks now, plus any picked attachments." confirm={syncSpec} onClick={() => syncNow()} disabled={syncing}><RotateCcw className="mr-1 h-3.5 w-3.5" />{syncing ? "Syncing…" : "Sync now"}</ActionButton>
          {isFinance && <ActionButton size="sm" variant="outline" hint="Opens the assistant: ask in plain English or compare the TMS with QuickBooks. It only builds lists — nothing changes until you tick rows and confirm." onClick={() => openWindow("reviewAssistant")}>Review assistant</ActionButton>}
        </div>
      ) : !isFinance && <p className="text-xs text-muted-foreground">An admin or accountant connects QuickBooks.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Aging k="Receivables — owed to us (AR)" b={arB} onClick={() => setSummaryOpen("ar")} />
        <Aging k="Payables — we owe carriers (AP)" b={apB} onClick={() => setSummaryOpen("ap")} />
        <Stat k="Quick Pay fee revenue" v={usd(qpRevenue)} detail={`Pending ${usd(qpPending)}`} onClick={() => setSummaryOpen("fees")} />
      </div>
      <div className="flex items-center justify-between gap-2">
        {syncError ? <span role="alert" className="text-sm text-destructive">Accounting records could not refresh: {syncError.message}</span> : <span className="text-xs text-muted-foreground">TMS records · {from || to || needle ? "Filtered totals" : "All dates"}</span>}
        <ActionButton size="sm" variant="ghost" disabled={refreshing} hint="Reloads invoices, carrier payments and fee totals from the TMS. Does not change QuickBooks." onClick={refreshAccounting}><RotateCcw className="mr-1 h-4 w-4" />{refreshing ? "Refreshing…" : "Refresh totals"}</ActionButton>
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
      {reviewQueue && <div className="flex flex-wrap items-center gap-2 border-y py-2 text-sm">
        <span className="flex-1">Checked-entry review {reviewQueue.index + 1} of {reviewQueue.rows.length} · {reviewQueue.rows[reviewQueue.index]?.load_number}</span>
        <Button size="sm" variant="outline" onClick={nextReview}>Skip / next entry</Button>
        <Button size="sm" variant="ghost" onClick={finishReview}>Stop review</Button>
      </div>}
      {tab !== "log" && <BulkActionBar key={tab} items={selectedLoads} total={shown.length} actions={reviewActions} onClear={() => setPicked([])} invalidate={["qb_sync", "loads", "load-work", "load_notes", "carrier_pay_due", "carrier_payments", "due_reminders"]} noun="loads" applyLabel="Apply to all checked" quickActions={["paid", "closeout", "paid_closeout"]} />}
      <div className="overflow-x-auto rounded-md border bg-card">
        {tab === "log" ? (
          <>
          <div className="p-2"><BulkActionBar items={shownSync.filter((x) => logSel.has(x.id))} total={shownSync.length} actions={logReviewActions} onClear={logSel.clear} applyLabel="Apply to all checked" invalidate={["qb_sync", "loads", "load-work", "load_notes", "carrier_pay_due", "carrier_payments", "due_reminders"]} noun="items" quickActions={["paid", "closeout", "paid_closeout"]} /></div>
          <Table>
            <TableHeader><TableRow><TableHead className="w-8"><SelectAllBox ids={shownSync.map((x) => x.id)} sel={logSel} /></TableHead><TableHead>Type</TableHead><TableHead>Load</TableHead><TableHead>Payee / customer</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Queued</TableHead><TableHead className="w-24">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {shownSync.map((s) => (
                <TableRow key={s.id}>
                  <TableCell><Checkbox aria-label="Select" checked={logSel.has(s.id)} onCheckedChange={(v) => logSel.toggle(s.id, v === true)} /></TableCell>
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
                    <div className="flex flex-wrap gap-1">
                      {isFinance && s.kind !== "bill" && <ActionButton size="sm" variant="outline" aria-label="Assign existing QuickBooks invoice" hint="Manually link or correct this invoice to an existing QuickBooks invoice and mark it sent in the TMS, without creating a duplicate." onClick={() => setLinking(s)}><Link2 className="mr-1 h-3.5 w-3.5" />Link QB invoice</ActionButton>}
                      {isFinance && <ActionButton size="icon" variant="ghost" aria-label="Edit invoice / terms" hint={HINT.edit} onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /></ActionButton>}
                      <ActionButton size="sm" variant="ghost" className="h-8 px-2" aria-label="Attach documents for QuickBooks" hint={HINT.attach} onClick={() => setAttaching(s)}><Paperclip className="h-3.5 w-3.5" />{attachCount(s) > 0 && <span className="ml-0.5 text-[10px]">{attachCount(s)}</span>}</ActionButton>
                      {s.status === "error" && s.error?.startsWith("Possible duplicate") && <ActionButton size="sm" variant="ghost" className="h-8 px-2 text-xs" hint="Sends this as a new QuickBooks invoice even though one with the same customer and amount exists." confirm={() => ({ title: "Send a new invoice anyway?", points: ["Only do this if the QuickBooks invoice shown in the error is for a different load.", "A new invoice is created in QuickBooks."], confirmLabel: "Send anyway" })} onClick={() => sendAnyway(s.id)}>Send anyway</ActionButton>}
                      {s.status === "error" && <ActionButton size="icon" variant="ghost" aria-label="Retry" hint={HINT.retry} confirm={retrySpec(s)} onClick={() => retry(s)}><RotateCcw className="h-3.5 w-3.5" /></ActionButton>}
                      {isFinance && <ActionButton size="icon" variant="ghost" aria-label="Remove from queue" hint={HINT.remove} confirm={removeSpec(s)} onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></ActionButton>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!shownSync.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">{needle || from || to ? "No matches." : "Nothing sent yet."}</TableCell></TableRow>}
            </TableBody>
          </Table>
          </>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox aria-label="Select all shown accounting loads" checked={shown.slice(0, limit).length > 0 && shown.slice(0, limit).every((l) => picked.includes(l.id)) ? true : shown.slice(0, limit).some((l) => picked.includes(l.id)) ? "indeterminate" : false} onCheckedChange={(v) => setPicked(v === true ? shown.slice(0, limit).map((r) => r.id) : [])} />
                </TableHead>
                <TableHead>Load</TableHead><TableHead>Lane</TableHead><TableHead>{tab === "bill" ? "Pay to" : "Bill to"}</TableHead><TableHead>Delivered</TableHead><TableHead>Age</TableHead><TableHead>Amount</TableHead><TableHead>{tab === "bill" ? "Carrier invoice" : "Invoice"}</TableHead><TableHead>QuickBooks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.slice(0, limit).map((l) => {
                const s = synced(l.id, tab as Kind);
                const bm = tab === "bill" ? billMath(l) : null;
                const mismatch = s?.carrier_invoice_amount != null && bm && Math.abs(Number(s.carrier_invoice_amount) - bm.gross) > 0.009;
                const extra = bm ? auditBill({ rcTotal: null, rcLines: [{ label: "Linehaul", amount: Number(l.carrier_rate) }, ...((l.accessorials as Accessorial[] | null) ?? []).map((a) => ({ label: a.type, amount: Number(a.amount) }))], loadCost: bm.gross, billed: null, billedLines: parseChargeLines(s?.carrier_invoice_lines) }).unexpected : [];
                const age = ageDays(l);
                return (
                  <TableRow key={l.id}>
                    <TableCell><Checkbox aria-label={`Select ${l.load_number}`} checked={picked.includes(l.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, l.id] : p.filter((x) => x !== l.id)))} /></TableCell>
                    <TableCell><LoadQuickLook load={l} />{tab !== "bill" && billedKind(l) !== invoiceKind(l) && <div className="text-[10px] text-warning">Billed through {billedKind(l) === "fleet_invoice" ? "Foust Farms" : "Clearwater"}</div>}</TableCell>
                    <TableCell>{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</TableCell>
                    <TableCell>{payee(l, tab as Kind)}</TableCell>
                    <TableCell>{fmtDate(l.delivery_at)}</TableCell>
                    <TableCell className={cn(age !== null && age > 30 && tab !== "bill" && "text-destructive font-medium")}>{age !== null ? `${age}d` : "—"}</TableCell>
                    <TableCell>
                      {usd(amountFor(l, tab as Kind))}
                      {bm && bm.fee > 0 && <div className="text-[10px] text-muted-foreground">{usd(bm.gross)} − {usd(bm.fee)} {bm.pt.value === "quickpay" ? "Quick Pay" : "Factored QP"} {Math.round(bm.rate * 1000) / 10}%</div>}
                    </TableCell>
                    <TableCell>
                      {tab === "bill" ? (
                        <div className="flex flex-col gap-1 text-xs">
                          {s?.carrier_invoice_path ? <DocLink items={[{ name: "Carrier invoice", bucket: "load-docs", path: s.carrier_invoice_path, readOnly: true }]}><FileText className="mr-1 inline h-3 w-3" />{s.carrier_invoice_amount != null ? usd(Number(s.carrier_invoice_amount)) : "View"}{s.carrier_invoice_number ? ` · #${s.carrier_invoice_number}` : ""}</DocLink> : null}
                          {mismatch && <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3" />Differs from rate con {usd(bm!.gross)}</span>}
                          {extra.length > 0 && <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3" />Not on rate con: {extra.map((x) => x.description).join(", ")}</span>}
                          <Hint text="Upload the carrier's own invoice. The TMS reads it and checks it against the signed rate con. Nothing is sent to QuickBooks.">
                            <button className="w-fit text-muted-foreground underline" onClick={() => setBillTarget(billTargetFor(l))}><Upload className="mr-1 inline h-3 w-3" />{s?.carrier_invoice_path ? "Review / replace" : "Attach carrier invoice"}</button>
                          </Hint>
                        </div>
                      ) : s?.invoice_number ? (
                        <div className="flex items-center gap-1 text-xs">
                          <Hint text="View the invoice PDF."><button className="text-gold underline" onClick={() => viewInvoice(s)}>{s.invoice_number}</button></Hint>
                          <ActionButton size="icon" variant="ghost" aria-label="Email invoice" hint="Downloads the invoice PDF and opens an email to the customer in your Gmail. Nothing is sent until you press Send there."
                            confirm={{ title: `Email invoice ${s.invoice_number}?`, points: ["Downloads the invoice PDF to this computer.", `Opens a new email to ${companyById.get(loadById.get(s.load_id)?.customer_id ?? "")?.email || "the customer (no email on file — add it in the email)"} from your Gmail.`, "Attach the PDF and press Send yourself — nothing goes out automatically.", "Does not change the invoice, the load or QuickBooks."], confirmLabel: "Open email" }}
                            onClick={() => emailInvoice(s)}><Mail className="h-3.5 w-3.5" /></ActionButton>
                          <ActionButton size="icon" variant="ghost" aria-label="Invoice packet" hint="Invoice packet: one PDF with the invoice, POD and BOL. Pick the documents, then preview, download or email it." onClick={() => setPacketRow(s)}><Files className="h-3.5 w-3.5" /></ActionButton>
                          {l.pod_received ? <span className="text-success">✓ POD</span> : <Hint text="No signed POD on this load yet."><span className="flex items-center gap-0.5 font-semibold text-destructive"><AlertTriangle className="h-3 w-3" />No POD</span></Hint>}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">Assigned when queued</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {s ? <Pill status={s.status} /> : <span className="text-xs text-muted-foreground">Not sent</span>}
                        {isFinance && tab !== "bill" && <ActionButton size="sm" variant="outline" aria-label="Assign existing QuickBooks invoice" hint="Link an invoice already in QuickBooks instead of sending a duplicate. Existing TMS invoices can be reassigned and marked sent; loads without a TMS invoice use the matching window." onClick={() => s ? setLinking(s) : openWindow("qbMatch")}><Link2 className="mr-1 h-3.5 w-3.5" />Link QB invoice</ActionButton>}
                        {s && isFinance && <ActionButton size="icon" variant="ghost" aria-label="Edit invoice / terms" hint={HINT.edit} onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /></ActionButton>}
                        {s && <ActionButton size="sm" variant="ghost" className="h-8 px-2" aria-label="Attach documents for QuickBooks" hint={HINT.attach} onClick={() => setAttaching(s)}><Paperclip className="h-3.5 w-3.5" />{attachCount(s) > 0 && <span className="ml-0.5 text-[10px]">{attachCount(s)}</span>}</ActionButton>}
                        {s && s.status === "error" && <ActionButton size="icon" variant="ghost" aria-label="Retry" hint={HINT.retry} confirm={retrySpec(s)} onClick={() => retry(s)}><RotateCcw className="h-3.5 w-3.5" /></ActionButton>}
                        {s && isFinance && <ActionButton size="icon" variant="ghost" aria-label="Remove from queue" hint={HINT.remove} confirm={removeSpec(s)} onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></ActionButton>}
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
      <Dialog open={summaryOpen !== null} onOpenChange={(open) => { if (!open) setSummaryOpen(null); }}>
        <DialogContent className="max-w-5xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{summaryTitle}</DialogTitle></DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{summaryRows.length} entries · {usd(summaryRows.reduce((t, r) => t + r.amount, 0))}</span>
            <ReportExport build={() => ({ title: summaryTitle, head: ["Load", "Customer ref", "Invoice #", "Payee", "Due", "Amount", "Status / fee"], right: [5], rows: summaryRows.map((r) => [r.load.load_number, r.load.customer_ref ?? "", r.invoice, r.payee, r.due, usd(r.amount), r.detail]) })} />
          </div>
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Load / customer ref</TableHead><TableHead>Invoice #</TableHead><TableHead>Customer / pay to</TableHead><TableHead>Due</TableHead><TableHead>Amount</TableHead><TableHead>Status / fee</TableHead></TableRow></TableHeader>
            <TableBody>{summaryRows.map((r, i) => <TableRow key={`${r.load.id}:${i}`}><TableCell><LoadQuickLook load={r.load} /><div className="text-xs text-muted-foreground">{r.load.customer_ref}</div></TableCell><TableCell>{r.invoice}</TableCell><TableCell>{r.payee}</TableCell><TableCell>{r.due}</TableCell><TableCell>{usd(r.amount)}</TableCell><TableCell>{r.detail}</TableCell></TableRow>)}
              {!summaryRows.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No matching entries.</TableCell></TableRow>}
            </TableBody>
          </Table></div>
        </DialogContent>
      </Dialog>
      {linking && <QbManualLinkDialog key={linking.id} row={linking} groupSize={groupOf(linking).length || 1} groupTotal={(groupOf(linking).length ? groupOf(linking) : [linking]).reduce((sum, row) => sum + owed(row), 0)} customerRef={loadById.get(linking.load_id)?.customer_ref} onClose={() => reviewQueue ? nextReview() : setLinking(null)} />}
      <InvoicePacketDialog invoiceNumber={packetRow?.invoice_number ?? null} loads={packetRow ? groupOf(packetRow).map((x) => loadById.get(x.load_id)).filter((l): l is Load => !!l) : []}
        buildInvoice={() => (packetRow ? invoicePdf(packetRow) : Promise.resolve(null))}
        onEmail={async (blob, name) => { if (packetRow) await emailInvoice(packetRow, { blob, name }); }} onClose={() => reviewQueue ? nextReview() : setPacketRow(null)} />
      <CarrierInvoiceDialog key={billTarget?.load.id ?? "none"} target={billTarget} onClose={() => reviewQueue ? nextReview() : setBillTarget(null)} onSaved={() => { if (reviewQueue) nextReview(); else setBillTarget(null); qc.invalidateQueries({ queryKey: ["qb_sync"] }); }} />
      <BillAuditDialog open={auditOpen} onOpenChange={setAuditOpen} loads={shown} billOf={(id) => synced(id, "bill")} payeeOf={(l) => payee(l, "bill")} onAttach={(l) => setBillTarget(billTargetFor(l))} />
      {paidOpen && <QbPaidDialog open={paidOpen} onOpenChange={setPaidOpen} />}
      {qbAuditOpen && <QbAuditDialog open={qbAuditOpen} onOpenChange={setQbAuditOpen} />}
      <FactoringRemittanceDialog open={factorOpen} onOpenChange={setFactorOpen} loads={loads} carriers={carrierById as Map<string, PayCarrier>} invoiced={invoicedIds} canPay={isFinance} />
      <EditSyncDialog row={editing} groupSize={editing ? groupOf(editing).length : 1} onClose={() => reviewQueue ? nextReview() : setEditing(null)} onSaved={() => { if (reviewQueue) nextReview(); else setEditing(null); qc.invalidateQueries({ queryKey: ["qb_sync"] }); }} />
      <QbAttachDialog key={attaching?.id ?? "none"} row={attaching} loads={attaching ? (attaching.kind !== "bill" ? groupOf(attaching) : [attaching]).map((x) => loads.find((l) => l.id === x.load_id)).filter((l): l is Load => !!l) : []}
        onClose={() => reviewQueue ? nextReview() : setAttaching(null)} onSaved={() => { if (reviewQueue) nextReview(); else setAttaching(null); qc.invalidateQueries({ queryKey: ["qb_sync"] }); }} />
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
          <ActionButton className="w-full" hintClassName="flex w-full" hint="Shows a before/after list of your changes to confirm. Invoices already in QuickBooks are not updated there." onClick={save}>Save changes</ActionButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ k, v, detail, onClick }: { k: string; v: string; detail?: string; onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick} className="h-auto w-full flex-col items-start whitespace-normal bg-card p-4 text-left">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className="font-display text-3xl text-gold">{v}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </Button>
  );
}
function Aging({ k, b, onClick }: { k: string; b: { total: number; a: number; b: number; c: number }; onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick} className="h-auto w-full flex-col items-start whitespace-normal bg-card p-4 text-left">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className="font-display text-3xl text-gold">{usd(b.total)}</span>
      <span className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground"><span>0–30d {usd(b.a)}</span><span>31–60d {usd(b.b)}</span><span className={b.c > 0 ? "text-destructive" : ""}>60+d {usd(b.c)}</span></span>
    </Button>
  );
}
function Pill({ status }: { status: string }) {
  const cls = status === "sent" ? "border-success text-success" : status === "error" ? "border-destructive text-destructive" : status === "hold" ? "border-muted-foreground text-muted-foreground" : "border-warning text-warning";
  return <span title={status === "hold" ? "Carrier invoice attached — not sent to QuickBooks until you send it" : undefined} className={cn("rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider", cls)}>{status === "hold" ? "on hold" : status}</span>;
}
