import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlarmClock, Download, FileText, Phone, Plus, Search, AlertTriangle, DollarSign, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { carriersQuery, companiesQuery, loadsQuery, profilesQuery } from "@/lib/queries";
import {
  STATUSES, statusMeta, usd, fmtDate, loadTotals, carrierCompliance, checkCallOverdue,
  ACCESSORIAL_TYPES, type Accessorial, type Load, type LoadStatus, type Carrier, type Company, type Profile,
} from "@/lib/tms";
import { RateConPanel } from "@/components/RateConPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadBuilderDialog } from "@/components/LoadBuilderDialog";
import { CarrierPicker } from "@/components/CarrierPicker";
import { cn } from "@/lib/utils";
import { FleetPanel } from "@/components/FleetPanel";
import { fleetQuery, driversQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/dispatch")({
  head: () => ({
    meta: [
      { title: "Dispatch Board — Clearwater Cargo TMS" },
      { name: "description", content: "Active load queue and load cockpit." },
      { property: "og:title", content: "Dispatch Board — Clearwater Cargo TMS" },
      { property: "og:description", content: "Active load queue and load cockpit." },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(loadsQuery),
      context.queryClient.ensureQueryData(carriersQuery),
      context.queryClient.ensureQueryData(companiesQuery),
      context.queryClient.ensureQueryData(profilesQuery),
      context.queryClient.ensureQueryData(fleetQuery),
      context.queryClient.ensureQueryData(driversQuery),
    ]),
  component: Dispatch,
});

function StatusSelect({ load }: { load: Load }) {
  const qc = useQueryClient();
  const m = statusMeta(load.status);
  return (
    <Select
      value={load.status}
      onValueChange={async (v) => {
        const patch: Partial<Load> = { status: v as LoadStatus };
        const { error } = await supabase.from("loads").update(patch).eq("id", load.id);
        if (error) toast.error(error.message);
        qc.invalidateQueries({ queryKey: ["loads"] });
      }}
    >
      <SelectTrigger className={cn("h-7 w-40 border text-xs font-medium", m.cls)} onClick={(e) => e.stopPropagation()}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            <span className={cn("rounded border px-1.5 py-0.5 text-xs", s.cls)}>{s.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function exportCsv(loads: Load[], format: "dat" | "truckstop") {
  const avail = loads.filter((l) => l.status === "available");
  if (!avail.length) return toast.info("No available loads to export.");
  const d = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US") : "");
  const rows =
    format === "dat"
      ? [
          ["Pickup Earliest*", "Pickup Latest", "Length (ft)*", "Weight (lbs)*", "Full/Partial*", "Equipment*", "Use Private Network*", "Private Network Rate", "Allow Private Network Booking", "Allow Private Network Bidding", "Use DAT Loadboard*", "DAT Loadboard Rate", "Allow DAT Loadboard Booking", "Use Extended Network", "Contact Method*", "Origin City*", "Origin State*", "Origin Postal Code", "Destination City*", "Destination State*", "Destination Postal Code", "Comment", "Commodity", "Reference ID"],
          ...avail.map((l) => [d(l.pickup_at), d(l.pickup_at), "53", String(l.weight_lbs ?? ""), "Full", datEquip(l.equipment), "no", "", "no", "no", "yes", "", "no", "no", "primary phone", l.origin_city, l.origin_state, "", l.dest_city, l.dest_state, "", l.pickup_notes ?? "", l.commodity ?? "", l.load_number]),
        ]
      : [
          ["Origin City", "Origin State", "Destination City", "Destination State", "Pickup Date", "Delivery Date", "Trailer Type", "Load Size", "Length", "Weight", "Payment Amount", "Commodity", "Comments", "Reference Number"],
          ...avail.map((l) => [l.origin_city, l.origin_state, l.dest_city, l.dest_state, d(l.pickup_at), d(l.delivery_at), l.equipment, "Full", "53", String(l.weight_lbs ?? ""), "", l.commodity ?? "", l.pickup_notes ?? "", l.load_number]),
        ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `clearwater-${format}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast.success(`Exported ${avail.length} loads for ${format === "dat" ? "DAT One" : "Truckstop"}.`);
}
const datEquip = (e: string) => ({ "Dry Van": "V", Reefer: "R", Flatbed: "F", "Step Deck": "SD", "Power Only": "PO", Conestoga: "CN", Hotshot: "HS", "Box Truck": "SB" })[e] ?? "V";

function Dispatch() {
  const { data: loads } = useSuspenseQuery(loadsQuery);
  const { data: carriers } = useSuspenseQuery(carriersQuery);
  const { data: companies } = useSuspenseQuery(companiesQuery);
  const { data: profiles } = useSuspenseQuery(profilesQuery);
  const { isAdmin } = useRouteContext({ from: "/_authenticated" });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [broker, setBroker] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(loads[0]?.id ?? null);
  const [builder, setBuilder] = useState(false);

  const filtered = useMemo(
    () =>
      loads.filter((l) => {
        if (status === "active" && ["paid"].includes(l.status)) return false;
        if (status !== "active" && status !== "all" && l.status !== status) return false;
        if (broker !== "all" && (broker === "none" ? l.broker_id : l.broker_id !== broker)) return false;
        const hay = `${l.load_number} ${l.origin_city} ${l.origin_state} ${l.dest_city} ${l.dest_state} ${l.commodity ?? ""}`.toLowerCase();
        return hay.includes(q.toLowerCase());
      }),
    [loads, q, status, broker],
  );
  const selected = loads.find((l) => l.id === selectedId) ?? null;
  const overdueCalls = loads.filter(checkCallOverdue);
  const carrierDue = loads.filter((l) => l.status === "delivered" && l.pod_received);
  const overdueInv = loads.filter((l) => l.status === "invoiced" && l.delivery_at && Date.now() - new Date(l.delivery_at).getTime() > 30 * 86400_000);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card/50 px-4 py-2 text-xs">
        <Alert icon={AlarmClock} tone="text-warning" n={overdueCalls.length} label={`check calls overdue (>${4}h)`} />
        <Alert icon={DollarSign} tone="text-teal" n={carrierDue.length} label="carrier payments due (POD received)" />
        <Alert icon={AlertTriangle} tone="text-destructive" n={overdueInv.length} label="customer invoices past 30 days" />
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportCsv(loads, "dat")}><Download className="mr-1 h-3.5 w-3.5" />DAT One CSV</Button>
          <Button size="sm" variant="outline" onClick={() => exportCsv(loads, "truckstop")}><Download className="mr-1 h-3.5 w-3.5" />Truckstop CSV</Button>
          <Button size="sm" onClick={() => setBuilder(true)}><Plus className="mr-1 h-3.5 w-3.5" />New load</Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(380px,40%)_1fr]">
        <section className="flex min-h-0 flex-col border-r">
          <div className="space-y-2 border-b p-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search load #, lane, commodity" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">All active</SelectItem>
                  <SelectItem value="all">Everything</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={broker} onValueChange={setBroker}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All brokers</SelectItem>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto">
            {filtered.map((l) => {
              const t = loadTotals(l);
              return (
                <li
                  key={l.id}
                  onClick={() => setSelectedId(l.id)}
                  className={cn("cursor-pointer border-b px-3 py-2.5 hover:bg-muted/50", selectedId === l.id && "border-l-2 border-l-gold bg-muted")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-gold">{l.load_number}</span>
                    <StatusSelect load={l} />
                  </div>
                  <div className="mt-1 font-display text-lg font-semibold leading-tight">
                    {l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{l.equipment} · {fmtDate(l.pickup_at)}{(l.truck_id || l.driver_id) && <span className="ml-2 rounded border border-teal px-1 text-[10px] uppercase text-teal">Our truck</span>}</span>
                    <span className="flex items-center gap-1">
                      {checkCallOverdue(l) && <AlarmClock className="h-3.5 w-3.5 text-warning" />}
                      {usd(t.revenue)}
                    </span>
                  </div>
                </li>
              );
            })}
            {!filtered.length && <li className="p-6 text-center text-sm text-muted-foreground">No loads match.</li>}
          </ul>
        </section>
        <section className="min-h-0 overflow-auto">
          {selected ? (
            <Cockpit key={selected.id} load={selected} loads={loads} carriers={carriers} companies={companies} profiles={profiles} isAdmin={isAdmin} />
          ) : (
            <div className="p-10 text-center text-muted-foreground">Select a load.</div>
          )}
        </section>
      </div>
      <LoadBuilderDialog open={builder} onOpenChange={setBuilder} companies={companies} onCreated={(id) => setSelectedId(id)} />
    </div>
  );
}

function Alert({ icon: Icon, tone, n, label }: { icon: typeof AlarmClock; tone: string; n: number; label: string }) {
  return (
    <span className={cn("flex items-center gap-1.5 rounded border px-2 py-1", n ? tone : "text-muted-foreground")}>
      <Icon className="h-3.5 w-3.5" />
      <b>{n}</b> {label}
    </span>
  );
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border bg-card p-4", className)}>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gold">{title}</h3>
      {children}
    </div>
  );
}
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

function Cockpit({
  load, loads, carriers, companies, profiles, isAdmin,
}: {
  load: Load;
  loads: Load[];
  carriers: Carrier[];
  companies: Company[];
  profiles: Profile[];
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const { user } = useRouteContext({ from: "/_authenticated" });
  const carrier = carriers.find((c) => c.id === load.carrier_id);
  const shipper = companies.find((c) => c.id === load.shipper_id);
  const consignee = companies.find((c) => c.id === load.consignee_id);
  const customer = companies.find((c) => c.id === load.customer_id);
  const t = loadTotals(load);
  const [carrierRate, setCarrierRate] = useState(String(load.carrier_rate));
  const [custRate, setCustRate] = useState(String(load.customer_rate));
  const [accType, setAccType] = useState<string>("Detention");
  const [accAmt, setAccAmt] = useState("");
  const [quickPay, setQuickPay] = useState(false);
  const [advance, setAdvance] = useState("");

  const update = async (patch: Partial<Load>, msg?: string) => {
    const { error } = await supabase.from("loads").update(patch).eq("id", load.id);
    if (error) return toast.error(error.message);
    if (msg) toast.success(msg);
    qc.invalidateQueries({ queryKey: ["loads"] });
  };

  const lane = useMemo(() => {
    const same = loads.filter((l) => l.origin_state === load.origin_state && l.dest_state === load.dest_state && l.dest_city === load.dest_city && Number(l.carrier_rate) > 0);
    const win = (days: number) => {
      const s = same.filter((l) => l.pickup_at && Date.now() - new Date(l.pickup_at).getTime() < days * 86400_000);
      if (!s.length) return null;
      const avg = (f: (l: Load) => number) => s.reduce((a, l) => a + f(l), 0) / s.length;
      const rev = avg((l) => loadTotals(l).revenue);
      const cost = avg((l) => loadTotals(l).cost);
      return { n: s.length, rev, cost, pct: rev ? ((rev - cost) / rev) * 100 : 0 };
    };
    return { d30: win(30), d90: win(90) };
  }, [loads, load]);

  const acc = (load.accessorials as Accessorial[]) ?? [];
  const compliance = carrier ? carrierCompliance(carrier) : null;
  const qpFee = quickPay ? t.cost * 0.03 : 0;
  const adv = Number(advance || 0);
  const advFee = adv ? Math.max(15, adv * 0.02) : 0;
  const netCarrier = t.cost - qpFee - adv - advFee;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm text-gold">{load.load_number}</div>
          <h2 className="text-3xl font-bold">{load.origin_city}, {load.origin_state} → {load.dest_city}, {load.dest_state}</h2>
          <div className="text-sm text-muted-foreground">{customer?.name ?? "No customer"} · {load.miles ?? "—"} mi</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusSelect load={load} />
          <Button size="sm" variant="outline" onClick={() => update({ last_check_call: new Date().toISOString() }, "Check call logged")}>
            <Phone className="mr-1 h-3.5 w-3.5" />Log check call
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Freight">
          <KV k="Equipment" v={load.equipment} />
          <KV k="Commodity" v={load.commodity ?? "—"} />
          <KV k="Weight / pieces" v={`${load.weight_lbs?.toLocaleString() ?? "—"} lbs · ${load.pieces ?? "—"} pcs`} />
          {load.temperature && <KV k="Temperature" v={load.temperature} />}
          <KV k="Broker" v={
            <Select value={load.broker_id ?? "none"} onValueChange={(v) => update({ broker_id: v === "none" ? null : v })} disabled={!isAdmin && !!load.broker_id && load.broker_id !== user.id}>
              <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {(isAdmin ? profiles : profiles.filter((p) => p.id === user.id)).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          } />
          <KV k="Last check call" v={<span className={checkCallOverdue(load) ? "text-warning" : ""}>{fmtDate(load.last_check_call)}</span>} />
        </Panel>

        <Panel title="Facilities">
          <div className="text-sm">
            <div className="text-xs uppercase text-muted-foreground">Pickup · {fmtDate(load.pickup_at)}</div>
            <div className="font-medium">{shipper?.name ?? `${load.origin_city}, ${load.origin_state}`}</div>
            <div className="text-muted-foreground">{shipper?.address} {shipper?.phone}</div>
            {load.pickup_notes && <div className="mt-1 rounded bg-muted p-2 text-xs">{load.pickup_notes}</div>}
            <div className="mt-3 text-xs uppercase text-muted-foreground">Delivery · {fmtDate(load.delivery_at)}</div>
            <div className="font-medium">{consignee?.name ?? `${load.dest_city}, ${load.dest_state}`}</div>
            <div className="text-muted-foreground">{consignee?.address} {consignee?.phone}</div>
            {load.delivery_notes && <div className="mt-1 rounded bg-muted p-2 text-xs">{load.delivery_notes}</div>}
          </div>
        </Panel>

        <Panel title="Carrier & compliance">
          <div className="mb-3">
            <CarrierPicker
              key={load.id + (load.carrier_id ?? "")}
              carriers={carriers}
              currentId={load.carrier_id}
              onPick={(id) => update({ carrier_id: id, status: id && load.status === "available" ? "booked" : load.status }, id ? "Carrier assigned" : "Carrier removed")}
              onAdded={() => qc.invalidateQueries({ queryKey: ["carriers"] })}
            />
          </div>
          {carrier && compliance && (
            <ul className="space-y-1 text-sm">
              <Check ok={carrier.authority_status === "Authorized"} label={`Operating authority: ${carrier.authority_status}`} />
              <Check ok={!!carrier.insurance_expires && new Date(carrier.insurance_expires) > new Date()} label={`Insurance through ${carrier.insurance_expires ?? "—"}`} />
              <Check ok={carrier.w9_received} label="W-9 on file" />
              <Check ok={carrier.coi_received} label="Certificate of insurance" />
              <Check ok={carrier.agreement_signed} label="Broker-carrier agreement" />
              <Check ok={load.ratecon_signed} label="Rate con signed" />
              <Check ok={load.pod_received} label="Signed POD received" />
              {carrier.factoring_company && <li className="pt-1 text-xs text-teal">Pay-to routed to factor: {carrier.factoring_company} (NOA)</li>}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!carrier} onClick={() => update({ ratecon_signed: !load.ratecon_signed })}>
              {load.ratecon_signed ? "Unmark signed" : "Mark rate con signed"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => update({ pod_received: !load.pod_received })}>
              {load.pod_received ? "Unmark POD" : "POD received"}
            </Button>
          </div>
          <RateConPanel load={load} carrier={carrier} shipper={shipper} consignee={consignee} customer={customer} onSaved={() => qc.invalidateQueries({ queryKey: ["loads"] })} />
        </Panel>

        <Panel title="Financials">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">Customer rate
              <Input value={custRate} onChange={(e) => setCustRate(e.target.value)} onBlur={() => update({ customer_rate: Number(custRate) || 0 })} />
            </label>
            <label className="text-xs text-muted-foreground">Carrier pay
              <Input value={carrierRate} onChange={(e) => setCarrierRate(e.target.value)} onBlur={() => update({ carrier_rate: Number(carrierRate) || 0 })} />
            </label>
          </div>
          <div className="mt-3 space-y-1">
            {acc.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{a.type}</span>
                <span className="flex items-center gap-2">{usd(a.amount)}
                  <button className="text-xs text-destructive" onClick={() => update({ accessorials: acc.filter((_, j) => j !== i) })}>remove</button>
                </span>
              </div>
            ))}
            <div className="flex gap-2">
              <Select value={accType} onValueChange={setAccType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{ACCESSORIAL_TYPES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
              <Input className="h-8 w-24" placeholder="$" value={accAmt} onChange={(e) => setAccAmt(e.target.value)} />
              <Button size="sm" variant="secondary" onClick={() => { if (!accAmt) return; update({ accessorials: [...acc, { type: accType, amount: Number(accAmt) }] }); setAccAmt(""); }}>Add</Button>
            </div>
          </div>
          <div className="mt-3 border-t pt-2">
            <KV k="Revenue" v={usd(t.revenue)} />
            <KV k="Carrier cost" v={usd(t.cost)} />
            <KV k="Margin" v={<b className={t.margin >= 0 ? "text-success" : "text-destructive"}>{usd(t.margin)} ({t.pct.toFixed(1)}%)</b>} />
          </div>
          <div className="mt-3 rounded bg-muted p-3 text-sm">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Carrier AP · QuickPay & advance</div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={quickPay} onChange={(e) => setQuickPay(e.target.checked)} />QuickPay (3% fee)</label>
            <label className="mt-2 flex items-center gap-2">Fuel advance <Input className="h-7 w-24" value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="$0" /></label>
            <KV k="QuickPay fee (finance revenue)" v={usd(qpFee)} />
            <KV k="Advance fee (2%, min $15)" v={usd(advFee)} />
            <KV k={`Net to ${carrier?.factoring_company ?? carrier?.legal_name ?? "carrier"}`} v={<b>{usd(netCarrier)}</b>} />
          </div>
        </Panel>

        <Panel title="Clearwater fleet assignment">
          <FleetPanel load={load} />
        </Panel>

        <Panel title="Lane intelligence">
          <div className="grid grid-cols-2 gap-4">
            {(["d30", "d90"] as const).map((k) => {
              const w = lane[k];
              return (
                <div key={k} className="rounded border p-3">
                  <div className="text-xs uppercase text-muted-foreground">{k === "d30" ? "Last 30 days" : "Last 90 days"} · {load.origin_state} → {load.dest_city}, {load.dest_state}</div>
                  {w ? (
                    <div className="mt-2 grid grid-cols-3 text-center">
                      <div><div className="font-display text-xl">{usd(w.rev)}</div><div className="text-xs text-muted-foreground">Shipper rate</div></div>
                      <div><div className="font-display text-xl">{usd(w.cost)}</div><div className="text-xs text-muted-foreground">Carrier pay</div></div>
                      <div><div className="font-display text-xl text-gold">{w.pct.toFixed(1)}%</div><div className="text-xs text-muted-foreground">Margin ({w.n} loads)</div></div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-muted-foreground">No Clearwater history on this lane yet.</div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
      {carrier?.status === "dnu" && (
        <div className="flex items-center gap-2 rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" /> Assigned carrier is now on the Do Not Use list ({carrier.dnu_reason}). Reassign immediately.
        </div>
      )}
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={cn("inline-block h-2 w-2 rounded-full", ok ? "bg-success" : "bg-destructive")} />
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}
