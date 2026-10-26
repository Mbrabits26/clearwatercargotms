import { useRouteContext, createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { useStickyState } from "@/hooks/useStickyState";
import { carriersQuery, companiesQuery, fetchAllPaged, loadsQuery, profilesQuery } from "@/lib/queries";
import { STATUSES, isFleetLoad, fmtDate, loadTotals, marginText, usd, type Load, type LoadStatus } from "@/lib/tms";
import { ReportExport } from "@/components/ReportExport";
import { dayText, type ReportRow, type ReportSpec } from "@/lib/reportExport";
import { ALL_STAGES, BILLING_STAGES, billingStage, invoiceNumberOf, stageLabel, syncByLoad, type BillingStage } from "@/lib/reportBilling";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/DatePicker";
import { LoadQuickLook } from "@/components/LoadQuickLook";
import { CarrierCheck } from "@/components/CarrierCheck";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { rangeFor, rangeOptions, type RangeKey } from "@/lib/dateRanges";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Clearwater Cargo TMS" },
      { name: "description", content: "Outstanding invoices, carrier payables and broker reports." },
      { property: "og:title", content: "Reports — Clearwater Cargo TMS" },
      { property: "og:description", content: "Outstanding invoices, carrier payables and broker reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(loadsQuery),
      context.queryClient.ensureQueryData(companiesQuery),
      context.queryClient.ensureQueryData(carriersQuery),
      context.queryClient.ensureQueryData(profilesQuery),
    ]),
  component: Reports,
});

type GroupBy = "none" | "customer" | "carrier" | "broker" | "lane" | "status" | "equipment" | "month" | "salesrep" | "billing";
type Col = "load" | "status" | "billing" | "customer" | "custref" | "shipref" | "destref" | "invoice" | "carrier" | "broker" | "lane" | "pickup" | "delivery" | "equipment" | "commodity" | "revenue" | "cost" | "margin" | "age" | "carrierpaid" | "salesrep" | "commission";
const COLS: { id: Col; label: string }[] = [
  { id: "load", label: "Load #" }, { id: "status", label: "Status" }, { id: "billing", label: "Billing stage" }, { id: "customer", label: "Customer" },
  { id: "custref", label: "Customer ref #" }, { id: "shipref", label: "Shipper PO / PU Ref #" }, { id: "destref", label: "Delivery ref / appt #" },
  { id: "invoice", label: "Invoice #" },
  { id: "carrier", label: "Carrier / pay to" }, { id: "broker", label: "Broker" }, { id: "lane", label: "Lane" },
  { id: "pickup", label: "Pickup" }, { id: "delivery", label: "Delivered" }, { id: "equipment", label: "Equipment" }, { id: "commodity", label: "Commodity" },
  { id: "revenue", label: "Customer amount" }, { id: "cost", label: "Carrier amount" }, { id: "margin", label: "Margin" },
  { id: "age", label: "Days outstanding" }, { id: "carrierpaid", label: "Carrier paid" }, { id: "salesrep", label: "Customer brought in by" }, { id: "commission", label: "Commission" },
];
type YesNo = "all" | "yes" | "no";
type Cfg = { statuses: LoadStatus[]; groupBy: GroupBy; cols: Col[]; needPod?: boolean; stages?: BillingStage[]; closed?: YesNo; carrierPaid?: YesNo };
const PRESETS: Record<string, { label: string; cfg: Cfg }> = {
  ar: { label: "Outstanding customer invoices", cfg: { statuses: ["delivered", "invoiced"], groupBy: "customer", cols: ["load", "status", "customer", "custref", "invoice", "lane", "delivery", "revenue", "age"] } },
  ap: { label: "Outstanding carrier payments", cfg: { statuses: ["delivered", "invoiced"], groupBy: "carrier", cols: ["load", "status", "carrier", "lane", "delivery", "cost", "age"] } },
  billing: { label: "Billing status", cfg: { statuses: STATUSES.map((s) => s.value), stages: ["needs_invoice", "invoiced", "sent"], groupBy: "billing", cols: ["load", "billing", "customer", "custref", "shipref", "invoice", "delivery", "revenue", "age"] } },
  broker: { label: "Broker loads booked", cfg: { statuses: ["booked", "dispatched", "rolling", "delivered", "invoiced", "paid", "issue"], groupBy: "broker", cols: ["load", "status", "customer", "lane", "pickup", "revenue", "cost", "margin"] } },
  lane: { label: "Lane profitability", cfg: { statuses: STATUSES.map((s) => s.value), groupBy: "lane", cols: ["load", "customer", "carrier", "pickup", "revenue", "cost", "margin"] } },
  commission: { label: "Customer commissions", cfg: { statuses: ["delivered", "invoiced", "paid"], groupBy: "salesrep", cols: ["load", "customer", "salesrep", "pickup", "revenue", "cost", "margin", "commission"] } },
  custom: { label: "Custom report", cfg: { statuses: STATUSES.map((s) => s.value), groupBy: "none", cols: ["load", "status", "customer", "carrier", "broker", "lane", "pickup", "revenue", "cost", "margin"] } },
};
const GROUPS: [GroupBy, string][] = [["none", "No grouping"], ["customer", "Customer"], ["carrier", "Carrier"], ["broker", "Broker"], ["salesrep", "Customer brought in by"], ["billing", "Billing stage"], ["lane", "Lane"], ["status", "Status"], ["equipment", "Equipment"], ["month", "Month"]];
type SyncRow = { load_id: string | null; kind: string; status: string; qb_ref: string | null; invoice_number: string | null };

function Reports() {
  const { isAdmin, user } = useRouteContext({ from: "/_authenticated" });
  const { data: loads } = useSuspenseQuery(loadsQuery);
  const { data: companies } = useSuspenseQuery(companiesQuery);
  const { data: carriers } = useSuspenseQuery(carriersQuery);
  const { data: profiles } = useSuspenseQuery(profilesQuery);
  // Report choices stay put when the user leaves Reports and comes back (per user, per tab).
  const k = (name: string) => `reports:${user.id}:${name}`;
  const [carrierView, setCarrierView] = useStickyState(k("carrierView"), false);
  const [fleetView, setFleetView] = useStickyState(k("fleetView"), false);
  const { data: comm = [] } = useQuery({ queryKey: ["commissions"], queryFn: async () => (await supabase.from("broker_commissions").select("*")).data ?? [] });
  const [salesRep, setSalesRep] = useStickyState(k("salesRep"), "all");
  const [storedPreset, setPreset] = useStickyState(k("preset"), "ar");
  const preset = PRESETS[storedPreset] && (storedPreset !== "commission" || isAdmin) ? storedPreset : "ar";
  const [cfg, setCfg] = useStickyState<Cfg>(k("cfg"), PRESETS.ar!.cfg);
  const [from, setFrom] = useStickyState(k("from"), "");
  const [to, setTo] = useStickyState(k("to"), "");
  const [range, setRange] = useStickyState<RangeKey>(k("range"), "all");
  const [broker, setBroker] = useStickyState(k("broker"), "all");
  const [customer, setCustomer] = useStickyState(k("customer"), "all");
  const [carrier, setCarrier] = useStickyState(k("carrier"), "all");
  const [q, setQ] = useStickyState(k("q"), "");

  const choose = (p: string) => { setPreset(p); setCfg(PRESETS[p]!.cfg); };
  const custName = (l: Load) => companies.find((c) => c.id === l.customer_id)?.name ?? "—";
  const carrName = (l: Load) => {
    if (!l.carrier_id) return l.truck_id || l.driver_id ? "Clearwater fleet" : "—";
    const c = carriers.find((x) => x.id === l.carrier_id);
    return c?.factoring_company ? `${c.factoring_company} (${c.legal_name})` : c?.legal_name ?? "—";
  };
  const repOf = (l: Load) => companies.find((c) => c.id === l.customer_id)?.sales_broker_id ?? null;
  const repName = (l: Load) => profiles.find((p) => p.id === repOf(l))?.full_name ?? "Not set";
  const commOf = (l: Load) => { const r = repOf(l); const pct = Number(comm.find((c) => c.user_id === r)?.commission_pct ?? 0); return r ? loadTotals(l).margin * pct / 100 : 0; };
  const brokerName = (l: Load) => profiles.find((p) => p.id === l.broker_id)?.full_name ?? "Unassigned";
  const laneOf = (l: Load) => `${l.origin_city}, ${l.origin_state} → ${l.dest_city}, ${l.dest_state}`;
  const age = (l: Load) => (l.delivery_at ? Math.max(0, Math.floor((Date.now() - new Date(l.delivery_at).getTime()) / 86400_000)) : 0);
  // Invoice records drive the billing stage and invoice # (paged: the database caps one read at 1000 rows).
  const { data: sync = [] } = useQuery({ queryKey: ["qb_sync", "report"], queryFn: async () => (await fetchAllPaged("qb_sync", "created_at", false)) as SyncRow[] });
  const syncMap = useMemo(() => syncByLoad(sync), [sync]);
  const stageOf = (l: Load) => billingStage(l, syncMap.get(l.id) ?? []);
  const invNo = (l: Load) => invoiceNumberOf(l.id, syncMap.get(l.id) ?? []);
  const stages = cfg.stages ?? ALL_STAGES;
  const closed = cfg.closed ?? "all";
  const carrierPaid = cfg.carrierPaid ?? "all";

  const rows = useMemo(
    () =>
      loads.filter((l) => {
        // Foust Farms loads never mix into brokerage money/margin reports; they have their own view.
        if (isFleetLoad(l) !== fleetView) return false;
        if (!cfg.statuses.includes(l.status)) return false;
        if (preset === "ap" && !l.carrier_id) return false;
        if (stages.length < ALL_STAGES.length && !stages.includes(stageOf(l))) return false;
        if (closed !== "all" && !!l.closed_at !== (closed === "yes")) return false;
        if (carrierPaid !== "all" && !!l.carrier_paid_at !== (carrierPaid === "yes")) return false;
        const d = l.pickup_at ? l.pickup_at.slice(0, 10) : "";
        if (from && d < from) return false;
        if (to && d > to) return false;
        if (broker !== "all" && l.broker_id !== broker) return false;
        if (customer !== "all" && l.customer_id !== customer) return false;
        if (carrier !== "all" && l.carrier_id !== carrier) return false;
        if (salesRep !== "all" && (salesRep === "none" ? repOf(l) : repOf(l) !== salesRep)) return false;
        if (!q) return true;
        return `${l.load_number} ${laneOf(l)} ${l.commodity ?? ""} ${l.customer_ref ?? ""} ${l.ship_ref ?? ""} ${l.dest_ref ?? ""} ${invNo(l)}`.toLowerCase().includes(q.toLowerCase());
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loads, fleetView, cfg, preset, from, to, broker, customer, carrier, q, salesRep, companies, syncMap],
  );

  const keyOf = (l: Load): string => {
    switch (cfg.groupBy) {
      case "customer": return custName(l);
      case "carrier": return carrName(l);
      case "broker": return brokerName(l);
      case "lane": return laneOf(l);
      case "status": return STATUSES.find((s) => s.value === l.status)!.label;
      case "billing": return stageLabel(stageOf(l));
      case "equipment": return l.equipment;
      case "month": return l.pickup_at ? l.pickup_at.slice(0, 7) : "No date";
      case "salesrep": return repName(l);
      default: return "All loads";
    }
  };
  const groups = useMemo(() => {
    const m = new Map<string, Load[]>();
    rows.forEach((l) => m.set(keyOf(l), [...(m.get(keyOf(l)) ?? []), l]));
    const order = (g: string) => BILLING_STAGES.findIndex((s) => s.label === g);
    return [...m.entries()].sort((a, b) => (cfg.groupBy === "billing" ? order(a[0]) - order(b[0]) : a[0].localeCompare(b[0])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cfg.groupBy]);

  const cell = (l: Load, c: Col): string => {
    const t = loadTotals(l);
    switch (c) {
      case "load": return l.load_number;
      case "status": return STATUSES.find((s) => s.value === l.status)!.label;
      case "billing": return stageLabel(stageOf(l)) + (l.closed_at ? " · Closed out" : "");
      case "customer": return custName(l);
      case "custref": return l.customer_ref ?? "";
      case "shipref": return l.ship_ref ?? "";
      case "destref": return l.dest_ref ?? "";
      case "invoice": return invNo(l);
      case "carrier": return carrName(l);
      case "broker": return brokerName(l);
      case "lane": return laneOf(l);
      case "pickup": return fmtDate(l.pickup_at);
      case "delivery": return fmtDate(l.delivery_at);
      case "equipment": return l.equipment;
      case "commodity": return l.commodity ?? "";
      case "revenue": return usd(t.revenue);
      case "cost": return usd(t.cost);
      case "margin": return marginText(t);
      case "age": return String(age(l));
      case "carrierpaid": return l.carrier_paid_at ? `Paid ${fmtDate(l.carrier_paid_at)}` : l.carrier_id ? "Unpaid" : "";
      case "salesrep": return repName(l);
      case "commission": return usd(commOf(l));
    }
  };
  const money: Col[] = ["revenue", "cost", "margin", "commission"];
  const sum = (ls: Load[], c: Col) => ls.reduce((s, l) => { const t = loadTotals(l); return s + (c === "revenue" ? t.revenue : c === "cost" ? t.cost : c === "commission" ? commOf(l) : t.margin); }, 0);

  const buildSpec = (): ReportSpec => {
    const grouped = cfg.groupBy !== "none";
    const totalCells = (label: string, ls: Load[]) => {
      const rev = sum(ls, "revenue"), mar = sum(ls, "margin");
      return cfg.cols.map((c, i) => {
        if (c === "revenue") return usd(rev);
        if (c === "cost") return usd(sum(ls, "cost"));
        if (c === "commission") return usd(sum(ls, "commission"));
        if (c === "margin") return fleetView ? "No margin — company truck" : `${usd(mar)} (${(rev ? (mar / rev) * 100 : 0).toFixed(1)}%)`;
        if (i === 0) return `${label} · ${ls.length} loads`;
        return "";
      });
    };
    const nameOf = (id: string, list: { id: string; name?: string | null; full_name?: string | null; legal_name?: string | null; email?: string | null }[]) => {
      const x = list.find((y) => y.id === id); return x?.name ?? x?.full_name ?? x?.legal_name ?? x?.email ?? id;
    };
    const rangeLabel = range === "custom" || !rangeOptions().some((o) => o.value === range) ? "Custom" : rangeOptions().find((o) => o.value === range)!.label;
    const filters = [
      `Pickup dates: ${from || to ? `${from ? dayText(from) : "start"} to ${to ? dayText(to) : "today"} (${rangeLabel})` : "All dates"}`,
      broker !== "all" && `Broker: ${nameOf(broker, profiles)}`,
      customer !== "all" && `Customer: ${nameOf(customer, companies)}`,
      carrier !== "all" && `Carrier: ${nameOf(carrier, carriers)}`,
      salesRep !== "all" && `Brought in by: ${salesRep === "none" ? "Not set" : nameOf(salesRep, profiles)}`,
      cfg.statuses.length < STATUSES.length && `Statuses: ${cfg.statuses.map((s) => STATUSES.find((x) => x.value === s)?.label ?? s).join(", ")}`,
      stages.length < ALL_STAGES.length && `Billing stage: ${stages.map(stageLabel).join(", ")}`,
      closed !== "all" && (closed === "yes" ? "Closed out only" : "Not closed out"),
      carrierPaid !== "all" && (carrierPaid === "yes" ? "Carrier paid only" : "Carrier not paid"),
      grouped && `Grouped by: ${GROUPS.find(([g]) => g === cfg.groupBy)?.[1] ?? cfg.groupBy}`,
      q && `Search: "${q}"`,
    ].filter((x): x is string => !!x);
    return {
      title: fleetView ? "Internal fleet records (Foust Farms)" : PRESETS[preset]!.label,
      company: fleetView ? "fleet" : "brokerage",
      filters,
      summary: [["Loads", String(rows.length)], ["Customer amount", usd(sum(rows, "revenue"))], ["Carrier amount", usd(sum(rows, "cost"))], ["Margin", fleetView ? "None (company trucks)" : usd(sum(rows, "margin"))]],
      head: cfg.cols.map((c) => COLS.find((x) => x.id === c)!.label),
      right: cfg.cols.flatMap((c, i) => (money.includes(c) || c === "age" ? [i] : [])),
      rows: groups.flatMap(([g, ls]): ReportRow[] => [
        ...(grouped ? [{ group: `${g} · ${ls.length} load${ls.length === 1 ? "" : "s"}` }] : []),
        ...ls.map((l) => cfg.cols.map((c) => cell(l, c))),
        ...(grouped ? [{ subtotal: totalCells("Subtotal", ls) }] : []),
      ]),
      total: rows.length ? totalCells("Grand total", rows) : undefined,
    };
  };

  const toggleStatus = (s: LoadStatus) => { setPreset("custom"); setCfg((c) => ({ ...c, statuses: c.statuses.includes(s) ? c.statuses.filter((x) => x !== s) : [...c.statuses, s] })); };
  const toggleCol = (col: Col) => { setPreset("custom"); setCfg((c) => ({ ...c, cols: c.cols.includes(col) ? c.cols.filter((x) => x !== col) : COLS.map((x) => x.id).filter((x) => x === col || c.cols.includes(x)) })); };
  const toggleStage = (s: BillingStage) => { setPreset("custom"); setCfg((c) => { const cur = c.stages ?? ALL_STAGES; return { ...c, stages: cur.includes(s) ? cur.filter((x) => x !== s) : ALL_STAGES.filter((x) => x === s || cur.includes(x)) }; }); };
  const setOpt = (key: "closed" | "carrierPaid", v: YesNo) => { setPreset("custom"); setCfg((c) => ({ ...c, [key]: v })); };

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-3xl font-bold uppercase">Reports</h1>
        {!carrierView && <ReportExport size="default" build={buildSpec} />}
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        {Object.entries(PRESETS).filter(([k]) => k !== "commission" || isAdmin).map(([k, p]) => (
          <button key={k} onClick={() => { setCarrierView(false); setFleetView(false); choose(k); }} className={cn("rounded-md border px-3 py-1.5 text-sm", !carrierView && !fleetView && preset === k ? "border-gold bg-gold/10 text-gold" : "text-muted-foreground hover:text-foreground")}>{p.label}</button>
        ))}
        <button onClick={() => { setCarrierView(false); setFleetView(true); choose("custom"); }} className={cn("rounded-md border px-3 py-1.5 text-sm", fleetView && !carrierView ? "border-teal bg-teal/15 text-teal" : "text-muted-foreground hover:text-foreground")}>Internal fleet records (Foust Farms)</button>
        <button onClick={() => setCarrierView(true)} className={cn("rounded-md border px-3 py-1.5 text-sm", carrierView ? "border-gold bg-gold/10 text-gold" : "text-muted-foreground hover:text-foreground")}>Carrier check</button>
      </div>
      {carrierView ? <div className="rounded-md border bg-card p-4"><CarrierCheck carriers={carriers} /></div> : <>
      <div className="space-y-3 rounded-md border bg-card p-4 print:hidden">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-7">
          <label className="text-xs text-muted-foreground">Date range
            <Select value={range} onValueChange={(v) => { setRange(v as RangeKey); const r = rangeFor(v as RangeKey); if (r) { setFrom(r[0]); setTo(r[1]); } }}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{rangeOptions().map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="text-xs text-muted-foreground">Pickup from<DatePicker className="mt-1" value={from} onChange={(v) => { setRange("custom"); setFrom(v); }} /></label>
          <label className="text-xs text-muted-foreground">Pickup to<DatePicker className="mt-1" value={to} onChange={(v) => { setRange("custom"); setTo(v); }} /></label>
          <Filter label="Broker" value={broker} set={setBroker} opts={profiles.map((p) => [p.id, p.full_name ?? p.email ?? ""])} />
          <Filter label="Customer" value={customer} set={setCustomer} opts={companies.filter((c) => c.kind === "customer").map((c) => [c.id, c.name])} />
          <Filter label="Customer brought in by" value={salesRep} set={setSalesRep} opts={[["none", "Not set"], ...profiles.map((p): [string, string] => [p.id, p.full_name ?? p.email ?? ""])]} />
          <Filter label="Carrier" value={carrier} set={setCarrier} opts={carriers.map((c) => [c.id, c.legal_name])} />
          <label className="text-xs text-muted-foreground">Group by
            <Select value={cfg.groupBy} onValueChange={(v) => { setPreset("custom"); setCfg((c) => ({ ...c, groupBy: v as GroupBy })); }}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{GROUPS.map(([g, label]) => <SelectItem key={g} value={g}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <Filter label="Closed out" value={closed} set={(v) => setOpt("closed", v as YesNo)} opts={[["no", "Not closed out"], ["yes", "Closed out only"]]} />
          <Filter label="Carrier paid" value={carrierPaid} set={(v) => setOpt("carrierPaid", v as YesNo)} opts={[["no", "Carrier not paid"], ["yes", "Carrier paid"]]} />
        </div>
        <Input placeholder="Search load #, customer ref #, PO / PU ref #, invoice #, lane, commodity" value={q} onChange={(e) => setQ(e.target.value)} />
        <Chips title="Billing stage" items={BILLING_STAGES.map((s) => [s.value, s.label])} on={stages} toggle={(v) => toggleStage(v as BillingStage)} />
        <Chips title="Statuses" items={STATUSES.map((s) => [s.value, s.label])} on={cfg.statuses} toggle={(v) => toggleStatus(v as LoadStatus)} />
        <Chips title="Columns" items={COLS.filter((c) => c.id !== "commission" || isAdmin).map((c) => [c.id, c.label])} on={cfg.cols} toggle={(v) => toggleCol(v as Col)} />
      </div>

      {fleetView && <div className="rounded border border-teal/50 bg-teal/10 p-2 text-sm text-teal">Showing Foust Farms internal fleet loads only. These are excluded from every brokerage report.</div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {[["Loads", String(rows.length)], ["Customer amount", usd(sum(rows, "revenue"))], ["Carrier amount", usd(sum(rows, "cost"))], ["Margin", fleetView ? "None (company trucks)" : usd(sum(rows, "margin"))]].map(([k, v]) => (
          <div key={k} className="rounded border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
            <div className="font-display text-3xl text-gold">{v}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader><TableRow>{cfg.cols.map((c) => <TableHead key={c}>{COLS.find((x) => x.id === c)!.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {groups.map(([g, ls]) => (
              <GroupRows key={g} title={cfg.groupBy === "none" ? null : g} loads={ls} cols={cfg.cols} cell={cell} money={money} sum={sum} />
            ))}
            {!rows.length && <TableRow><TableCell colSpan={cfg.cols.length} className="text-center text-muted-foreground">No loads match this report.</TableCell></TableRow>}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>{cfg.cols.map((c, i) => <TableCell key={c} className="font-bold">{i === 0 ? "Grand total" : money.includes(c) ? usd(sum(rows, c)) : ""}</TableCell>)}</TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      </>}
    </div>
  );
}

function GroupRows({ title, loads, cols, cell, money, sum }: { title: string | null; loads: Load[]; cols: Col[]; cell: (l: Load, c: Col) => string; money: Col[]; sum: (ls: Load[], c: Col) => number }) {
  return (
    <>
      {title && <TableRow className="bg-muted/60"><TableCell colSpan={cols.length} className="font-display text-base font-semibold text-gold">{title} · {loads.length} load{loads.length === 1 ? "" : "s"}</TableCell></TableRow>}
      {loads.map((l) => <TableRow key={l.id}>{cols.map((c) => <TableCell key={c} className={c === "load" ? "font-mono text-gold" : ""}>{c === "load" ? <LoadQuickLook load={l} /> : cell(l, c)}</TableCell>)}</TableRow>)}
      {title && <TableRow>{cols.map((c, i) => <TableCell key={c} className="text-xs font-semibold text-muted-foreground">{i === 0 ? "Subtotal" : money.includes(c) ? usd(sum(loads, c)) : ""}</TableCell>)}</TableRow>}
    </>
  );
}

function Filter({ label, value, set, opts }: { label: string; value: string; set: (v: string) => void; opts: [string, string][] }) {
  return (
    <label className="text-xs text-muted-foreground">{label}
      <Select value={value} onValueChange={set}>
        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">All</SelectItem>{opts.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  );
}
function Chips({ title, items, on, toggle }: { title: string; items: [string, string][]; on: string[]; toggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs uppercase tracking-wider text-muted-foreground">{title}</span>
      {items.map(([v, l]) => (
        <button key={v} onClick={() => toggle(v)} className={cn("rounded border px-2 py-0.5 text-xs", on.includes(v) ? "border-teal bg-teal/20 text-foreground" : "text-muted-foreground")}>{l}</button>
      ))}
    </div>
  );
}
