import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { carriersQuery, companiesQuery, loadsQuery, profilesQuery } from "@/lib/queries";
import { STATUSES, fmtDate, loadTotals, usd, type Load, type LoadStatus } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/DatePicker";
import { LoadQuickLook } from "@/components/LoadQuickLook";
import { CarrierCheck } from "@/components/CarrierCheck";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Clearwater Cargo TMS" },
      { name: "description", content: "Outstanding invoices, carrier payables and broker reports." },
      { property: "og:title", content: "Reports — Clearwater Cargo TMS" },
      { property: "og:description", content: "Outstanding invoices, carrier payables and broker reports." },
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

type GroupBy = "none" | "customer" | "carrier" | "broker" | "lane" | "status" | "equipment" | "month";
type Col = "load" | "status" | "customer" | "carrier" | "broker" | "lane" | "pickup" | "delivery" | "equipment" | "revenue" | "cost" | "margin" | "age";
const COLS: { id: Col; label: string }[] = [
  { id: "load", label: "Load #" }, { id: "status", label: "Status" }, { id: "customer", label: "Customer" },
  { id: "carrier", label: "Carrier / pay to" }, { id: "broker", label: "Broker" }, { id: "lane", label: "Lane" },
  { id: "pickup", label: "Pickup" }, { id: "delivery", label: "Delivered" }, { id: "equipment", label: "Equipment" },
  { id: "revenue", label: "Customer amount" }, { id: "cost", label: "Carrier amount" }, { id: "margin", label: "Margin" },
  { id: "age", label: "Days outstanding" },
];
type Cfg = { statuses: LoadStatus[]; groupBy: GroupBy; cols: Col[]; needPod?: boolean };
const PRESETS: Record<string, { label: string; cfg: Cfg }> = {
  ar: { label: "Outstanding customer invoices", cfg: { statuses: ["delivered", "invoiced"], groupBy: "customer", cols: ["load", "status", "customer", "lane", "delivery", "revenue", "age"] } },
  ap: { label: "Outstanding carrier payments", cfg: { statuses: ["delivered", "invoiced"], groupBy: "carrier", cols: ["load", "status", "carrier", "lane", "delivery", "cost", "age"] } },
  broker: { label: "Broker loads booked", cfg: { statuses: ["booked", "dispatched", "rolling", "delivered", "invoiced", "paid", "issue"], groupBy: "broker", cols: ["load", "status", "customer", "lane", "pickup", "revenue", "cost", "margin"] } },
  lane: { label: "Lane profitability", cfg: { statuses: STATUSES.map((s) => s.value), groupBy: "lane", cols: ["load", "customer", "carrier", "pickup", "revenue", "cost", "margin"] } },
  custom: { label: "Custom report", cfg: { statuses: STATUSES.map((s) => s.value), groupBy: "none", cols: ["load", "status", "customer", "carrier", "broker", "lane", "pickup", "revenue", "cost", "margin"] } },
};

function Reports() {
  const { data: loads } = useSuspenseQuery(loadsQuery);
  const { data: companies } = useSuspenseQuery(companiesQuery);
  const { data: carriers } = useSuspenseQuery(carriersQuery);
  const { data: profiles } = useSuspenseQuery(profilesQuery);
  const [carrierView, setCarrierView] = useState(false);
  const [preset, setPreset] = useState("ar");
  const [cfg, setCfg] = useState<Cfg>(PRESETS.ar!.cfg);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [broker, setBroker] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [carrier, setCarrier] = useState("all");
  const [q, setQ] = useState("");

  const choose = (p: string) => { setPreset(p); setCfg(PRESETS[p]!.cfg); };
  const custName = (l: Load) => companies.find((c) => c.id === l.customer_id)?.name ?? "—";
  const carrName = (l: Load) => {
    if (!l.carrier_id) return l.truck_id || l.driver_id ? "Clearwater fleet" : "—";
    const c = carriers.find((x) => x.id === l.carrier_id);
    return c?.factoring_company ? `${c.factoring_company} (${c.legal_name})` : c?.legal_name ?? "—";
  };
  const brokerName = (l: Load) => profiles.find((p) => p.id === l.broker_id)?.full_name ?? "Unassigned";
  const laneOf = (l: Load) => `${l.origin_city}, ${l.origin_state} → ${l.dest_city}, ${l.dest_state}`;
  const age = (l: Load) => (l.delivery_at ? Math.max(0, Math.floor((Date.now() - new Date(l.delivery_at).getTime()) / 86400_000)) : 0);

  const rows = useMemo(
    () =>
      loads.filter((l) => {
        if (!cfg.statuses.includes(l.status)) return false;
        if (preset === "ap" && !l.carrier_id) return false;
        const d = l.pickup_at ? l.pickup_at.slice(0, 10) : "";
        if (from && d < from) return false;
        if (to && d > to) return false;
        if (broker !== "all" && l.broker_id !== broker) return false;
        if (customer !== "all" && l.customer_id !== customer) return false;
        if (carrier !== "all" && l.carrier_id !== carrier) return false;
        return `${l.load_number} ${laneOf(l)} ${l.commodity ?? ""}`.toLowerCase().includes(q.toLowerCase());
      }),
    [loads, cfg, preset, from, to, broker, customer, carrier, q],
  );

  const keyOf = (l: Load): string => {
    switch (cfg.groupBy) {
      case "customer": return custName(l);
      case "carrier": return carrName(l);
      case "broker": return brokerName(l);
      case "lane": return laneOf(l);
      case "status": return STATUSES.find((s) => s.value === l.status)!.label;
      case "equipment": return l.equipment;
      case "month": return l.pickup_at ? l.pickup_at.slice(0, 7) : "No date";
      default: return "All loads";
    }
  };
  const groups = useMemo(() => {
    const m = new Map<string, Load[]>();
    rows.forEach((l) => m.set(keyOf(l), [...(m.get(keyOf(l)) ?? []), l]));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cfg.groupBy]);

  const cell = (l: Load, c: Col): string => {
    const t = loadTotals(l);
    switch (c) {
      case "load": return l.load_number;
      case "status": return STATUSES.find((s) => s.value === l.status)!.label;
      case "customer": return custName(l);
      case "carrier": return carrName(l);
      case "broker": return brokerName(l);
      case "lane": return laneOf(l);
      case "pickup": return fmtDate(l.pickup_at);
      case "delivery": return fmtDate(l.delivery_at);
      case "equipment": return l.equipment;
      case "revenue": return usd(t.revenue);
      case "cost": return usd(t.cost);
      case "margin": return `${usd(t.margin)} (${t.pct.toFixed(1)}%)`;
      case "age": return String(age(l));
    }
  };
  const money: Col[] = ["revenue", "cost", "margin"];
  const sum = (ls: Load[], c: Col) => ls.reduce((s, l) => { const t = loadTotals(l); return s + (c === "revenue" ? t.revenue : c === "cost" ? t.cost : t.margin); }, 0);

  const exportCsv = () => {
    const head = [...(cfg.groupBy !== "none" ? ["Group"] : []), ...cfg.cols.map((c) => COLS.find((x) => x.id === c)!.label)];
    const lines = [head, ...groups.flatMap(([g, ls]) => ls.map((l) => [...(cfg.groupBy !== "none" ? [g] : []), ...cfg.cols.map((c) => cell(l, c))]))];
    const csv = lines.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `clearwater-${preset}-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const toggleStatus = (s: LoadStatus) => { setPreset("custom"); setCfg((c) => ({ ...c, statuses: c.statuses.includes(s) ? c.statuses.filter((x) => x !== s) : [...c.statuses, s] })); };
  const toggleCol = (col: Col) => { setPreset("custom"); setCfg((c) => ({ ...c, cols: c.cols.includes(col) ? c.cols.filter((x) => x !== col) : COLS.map((x) => x.id).filter((x) => x === col || c.cols.includes(x)) })); };

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-3xl font-bold uppercase">Reports</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print</Button>
          <Button onClick={exportCsv}><Download className="mr-1 h-4 w-4" />Export CSV</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} onClick={() => { setCarrierView(false); choose(k); }} className={cn("rounded-md border px-3 py-1.5 text-sm", !carrierView && preset === k ? "border-gold bg-gold/10 text-gold" : "text-muted-foreground hover:text-foreground")}>{p.label}</button>
        ))}
        <button onClick={() => setCarrierView(true)} className={cn("rounded-md border px-3 py-1.5 text-sm", carrierView ? "border-gold bg-gold/10 text-gold" : "text-muted-foreground hover:text-foreground")}>Carrier check</button>
      </div>
      {carrierView ? <div className="rounded-md border bg-card p-4"><CarrierCheck carriers={carriers} /></div> : <>
      <div className="space-y-3 rounded-md border bg-card p-4 print:hidden">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <label className="text-xs text-muted-foreground">Pickup from<DatePicker className="mt-1" value={from} onChange={setFrom} /></label>
          <label className="text-xs text-muted-foreground">Pickup to<DatePicker className="mt-1" value={to} onChange={setTo} /></label>
          <Filter label="Broker" value={broker} set={setBroker} opts={profiles.map((p) => [p.id, p.full_name ?? p.email ?? ""])} />
          <Filter label="Customer" value={customer} set={setCustomer} opts={companies.filter((c) => c.kind === "customer").map((c) => [c.id, c.name])} />
          <Filter label="Carrier" value={carrier} set={setCarrier} opts={carriers.map((c) => [c.id, c.legal_name])} />
          <label className="text-xs text-muted-foreground">Group by
            <Select value={cfg.groupBy} onValueChange={(v) => { setPreset("custom"); setCfg((c) => ({ ...c, groupBy: v as GroupBy })); }}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{["none", "customer", "carrier", "broker", "lane", "status", "equipment", "month"].map((g) => <SelectItem key={g} value={g}>{g === "none" ? "No grouping" : g[0]!.toUpperCase() + g.slice(1)}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>
        <Input placeholder="Search load #, lane, commodity" value={q} onChange={(e) => setQ(e.target.value)} />
        <Chips title="Statuses" items={STATUSES.map((s) => [s.value, s.label])} on={cfg.statuses} toggle={(v) => toggleStatus(v as LoadStatus)} />
        <Chips title="Columns" items={COLS.map((c) => [c.id, c.label])} on={cfg.cols} toggle={(v) => toggleCol(v as Col)} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {[["Loads", String(rows.length)], ["Customer amount", usd(sum(rows, "revenue"))], ["Carrier amount", usd(sum(rows, "cost"))], ["Margin", usd(sum(rows, "margin"))]].map(([k, v]) => (
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
