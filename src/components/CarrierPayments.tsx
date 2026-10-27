import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Banknote, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { carrierPayDue, carrierPayState, carrierPaySummary, PAY_STATE_LABEL, payTo, type CarrierPayState } from "@/lib/carrierPay";
import { FLEET_CARRIER_ID, isFleetLoad, usd, type Carrier, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReportExport } from "@/components/ReportExport";
import { Hint, useConfirm } from "@/components/ActionGuard";
import type { ReportSpec } from "@/lib/reportExport";
import { cn } from "@/lib/utils";

const day = (s: string | number | null | undefined) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const dueText = (n: number) => (n < 0 ? `${-n} day${n === -1 ? "" : "s"} late` : n === 0 ? "due today" : `in ${n} day${n === 1 ? "" : "s"}`);
type Tab = "unpaid" | "paid" | "all";
const STATE_CLS: Record<CarrierPayState, string> = { paid: "text-success", owed: "text-gold", waiting_pod: "text-warning", not_delivered: "text-muted-foreground" };

function useCarrierPayLoads(carrierId: string) {
  return useQuery({
    queryKey: ["carrier_payments", carrierId],
    staleTime: 30_000,
    queryFn: async () => {
      const loads: Load[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("loads").select("*").eq("carrier_id", carrierId).neq("status", "cancelled")
          .order("pickup_at", { ascending: false, nullsFirst: false }).order("id").range(from, from + 999);
        if (error) throw error;
        loads.push(...((data ?? []) as Load[]));
        if (!data || data.length < 1000) break;
      }
      const brokered = loads.filter((l) => !isFleetLoad(l));
      const ids = brokered.map((l) => l.id);
      const invoiced = new Set<string>();
      const bills = new Map<string, { status: string; qb_ref: string | null }>();
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await supabase.from("qb_sync").select("load_id, kind, status, qb_ref").in("load_id", ids.slice(i, i + 150));
        for (const s of data ?? []) {
          if (!s.load_id) continue;
          if (s.kind === "bill") bills.set(s.load_id, { status: s.status, qb_ref: s.qb_ref });
          else invoiced.add(s.load_id);
        }
      }
      return { loads: brokered, invoiced, bills };
    },
  });
}

/** Carrier page panel: what we've paid this carrier and what we still owe, with a full payment-history window. */
export function CarrierPayments({ c }: { c: Carrier }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useCarrierPayLoads(c.id);
  const sum = useMemo(() => (data ? carrierPaySummary(data.loads, c, data.invoiced) : null), [data, c]);
  if (c.id === FLEET_CARRIER_ID) return null;
  const tile = (k: CarrierPayState, extra?: string) => (
    <div className="rounded border p-2">
      <div className={cn("text-[11px] uppercase tracking-wider", STATE_CLS[k])}>{PAY_STATE_LABEL[k]}</div>
      <div className="text-lg font-semibold">{usd(sum?.[k].net ?? 0)}</div>
      <div className="text-xs text-muted-foreground">{sum?.[k].count ?? 0} load{sum?.[k].count === 1 ? "" : "s"}{extra}</div>
    </div>
  );
  return (
    <div className="rounded border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-gold"><Banknote className="h-4 w-4" />Carrier payments</h3>
        <Hint text="Opens a window listing every load this carrier hauled for us, split into paid and not paid, with amounts, due dates and check / ACH refs.">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Open paid / not paid</Button>
        </Hint>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading payments…</p> : (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {tile("owed", sum?.pastDue ? ` · ${sum.pastDue} past due` : "")}
          {tile("waiting_pod")}
          {tile("not_delivered")}
          {tile("paid")}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Amounts are net to the carrier (after any Quick Pay fee). Company-truck and cancelled loads are left out.</p>
      {open && data && <CarrierPaymentsDialog c={c} data={data} open={open} onOpenChange={setOpen} />}
    </div>
  );
}

function CarrierPaymentsDialog({ c, data, open, onOpenChange }: {
  c: Carrier; data: NonNullable<ReturnType<typeof useCarrierPayLoads>["data"]>; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const { isFinance } = useRouteContext({ from: "/_authenticated" });
  const qc = useQueryClient();
  const ask = useConfirm();
  const [tab, setTab] = useState<Tab>("unpaid");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const to = payTo(c);

  const items = useMemo(() => data.loads.map((l) => ({ l, s: carrierPayState(l, data.invoiced.has(l.id)), d: carrierPayDue(l, c), bill: data.bills.get(l.id) })), [data, c]);
  const counts = { unpaid: items.filter((x) => x.s !== "paid").length, paid: items.filter((x) => x.s === "paid").length, all: items.length };
  const term = q.trim().toLowerCase();
  const rows = items
    .filter((x) => (tab === "all" ? true : tab === "paid" ? x.s === "paid" : x.s !== "paid"))
    .filter((x) => !term || `${x.l.load_number} ${x.l.customer_ref ?? ""} ${x.l.ship_ref ?? ""} ${x.l.carrier_paid_ref ?? ""} ${x.l.origin_city} ${x.l.dest_city}`.toLowerCase().includes(term))
    .sort((a, b) => tab === "paid" ? (b.l.carrier_paid_at ?? "").localeCompare(a.l.carrier_paid_at ?? "") : b.d.podAt - a.d.podAt);
  const owedRows = rows.filter((x) => x.s === "owed");
  const chosen = owedRows.filter((x) => picked.includes(x.l.id));
  const chosenNet = chosen.reduce((t, x) => t + x.d.net, 0);
  const net = rows.reduce((t, x) => t + x.d.net, 0);

  const markPaid = async () => {
    if (!chosen.length) return toast.info("Tick the owed loads you paid.");
    if (!(await ask({
      title: `Mark ${chosen.length} load${chosen.length === 1 ? "" : "s"} paid to ${to.name}?`,
      body: `Total ${usd(chosenNet)}${ref.trim() ? ` · Ref ${ref.trim()}` : " · no check # / ACH ref entered"}.`,
      points: [
        "Records today as the carrier paid date on these loads, with your reference.",
        "They move to the Paid list here and drop off Carriers to be paid.",
        "This does not send money, and does not change QuickBooks or the customer invoice.",
        "The load status (Delivered, Invoiced, Paid) does not change.",
      ],
      confirmLabel: "Mark paid",
    }))) return;
    setBusy(true);
    const { error } = await supabase.from("loads").update({ carrier_paid_at: new Date().toISOString(), carrier_paid_ref: ref.trim() || null }).in("id", chosen.map((x) => x.l.id));
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${chosen.length} load(s) paid`);
    setPicked([]); setRef("");
    qc.invalidateQueries({ queryKey: ["carrier_payments", c.id] });
    qc.invalidateQueries({ queryKey: ["carrier_pay_due"] });
    qc.invalidateQueries({ queryKey: ["loads"] });
  };

  const build = (): ReportSpec => ({
    title: `Carrier payments — ${c.legal_name}`,
    subtitle: `Pay to: ${to.name}${to.factored ? ` (factoring company for ${to.forCarrier})` : ""}`,
    filters: [`MC ${c.mc_number || "—"} · DOT ${c.dot_number || "—"}`, tab === "paid" ? "Paid loads" : tab === "unpaid" ? "Not paid loads" : "All loads", ...(term ? [`Search: ${q.trim()}`] : [])],
    summary: [["Loads", String(rows.length)], ["Net", usd(net)]],
    head: ["Load", "Customer ref #", "Lane", "Pickup", "Pay status", "Due / paid", "Terms", "Carrier pay", "Quick Pay fee", "Net", "Check / ACH ref"], right: [7, 8, 9],
    rows: rows.map(({ l, s, d }) => [l.load_number, l.customer_ref ?? "", `${l.origin_city}, ${l.origin_state} → ${l.dest_city}, ${l.dest_state}`, day(l.pickup_at), PAY_STATE_LABEL[s],
      s === "paid" ? `Paid ${day(l.carrier_paid_at)}` : s === "owed" ? `${day(d.due)} (${dueText(d.daysLeft)})` : "", d.pt.terms, usd(d.gross), d.fee ? usd(d.fee) : "", usd(d.net), l.carrier_paid_ref ?? ""]),
    total: ["Total", "", `${rows.length} loads`, "", "", "", "", usd(rows.reduce((t, x) => t + x.d.gross, 0)), usd(rows.reduce((t, x) => t + x.d.fee, 0)), usd(net), ""],
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88dvh] w-[96vw] flex-col gap-3 sm:max-w-6xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-display text-2xl uppercase">Payments — {c.legal_name}</DialogTitle>
          <DialogDescription>Pay to {to.name}{to.factored ? ` (factoring company)` : ""}. Every load this carrier hauled for us, paid and not paid.</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(["unpaid", "paid", "all"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => { setTab(t); setPicked([]); }}>
              {t === "unpaid" ? "Not paid" : t === "paid" ? "Paid" : "All"} ({counts[t]})
            </Button>
          ))}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Load #, ref #, check #, city" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="text-sm text-muted-foreground">{rows.length} load{rows.length === 1 ? "" : "s"} · <b className="text-foreground">{usd(net)}</b></span>
          <ReportExport className="ml-auto" build={build} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded border">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs uppercase text-muted-foreground">
              <tr>
                {isFinance && <th className="p-2 w-8">{owedRows.length > 0 && <Checkbox checked={chosen.length === owedRows.length} onCheckedChange={(v) => setPicked(v ? owedRows.map((x) => x.l.id) : [])} aria-label="Select all owed" />}</th>}
                <th className="p-2">Load</th><th className="p-2">Pickup</th><th className="p-2">Pay status</th><th className="p-2">Due / paid</th><th className="p-2">Terms</th>
                <th className="p-2 text-right">Carrier pay</th><th className="p-2 text-right">QP fee</th><th className="p-2 text-right">Net</th><th className="p-2">QuickBooks bill</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ l, s, d, bill }) => (
                <tr key={l.id} className="border-t">
                  {isFinance && <td className="p-2">{s === "owed" && <Checkbox checked={picked.includes(l.id)} onCheckedChange={(v) => setPicked((p) => (v ? [...p, l.id] : p.filter((x) => x !== l.id)))} aria-label={`Select ${l.load_number}`} />}</td>}
                  <td className="p-2 font-semibold">{l.load_number}
                    <div className="text-xs font-normal text-muted-foreground">{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}{l.customer_ref ? ` · Ref ${l.customer_ref}` : ""}</div>
                  </td>
                  <td className="p-2">{day(l.pickup_at)}</td>
                  <td className={cn("p-2 text-xs font-semibold", STATE_CLS[s])}>{PAY_STATE_LABEL[s]}</td>
                  <td className={cn("p-2", s === "owed" && d.daysLeft < 0 && "font-semibold text-destructive")}>
                    {s === "paid" ? <>{day(l.carrier_paid_at)}{l.carrier_paid_ref && <div className="text-xs text-muted-foreground">Ref {l.carrier_paid_ref}</div>}</>
                      : s === "owed" ? <>{day(d.due)}<div className="text-xs">{dueText(d.daysLeft)}{d.fromPod ? "" : " · no POD"}</div></>
                      : <span className="text-xs text-muted-foreground">{s === "waiting_pod" ? "Clock starts at POD" : "—"}</span>}
                  </td>
                  <td className="p-2">{d.pt.terms}</td>
                  <td className="p-2 text-right">{usd(d.gross)}</td>
                  <td className="p-2 text-right">{d.fee ? `−${usd(d.fee)}` : "—"}</td>
                  <td className="p-2 text-right font-semibold">{usd(d.net)}</td>
                  <td className="p-2 text-xs capitalize">{bill ? (bill.qb_ref ? "In QuickBooks" : bill.status) : "Not sent"}</td>
                  <td className="p-2 text-right"><Link to="/dispatch" search={{ load: l.id }} onClick={() => onOpenChange(false)} className="text-gold underline">Open load</Link></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">No loads here.</td></tr>}
            </tbody>
          </table>
        </div>
        {isFinance && tab !== "paid" && owedRows.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-end gap-2 rounded border p-3">
            <div className="mr-auto text-sm">Selected: <b>{chosen.length}</b> owed load(s) · <b className="text-gold">{usd(chosenNet)}</b></div>
            <label className="text-xs text-muted-foreground">Check # / ACH ref (optional)<Input className="mt-1 h-9 w-48" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
            <Hint text="Records the ticked loads as paid to this carrier (after you confirm). Doesn't send money or change QuickBooks.">
              <Button disabled={busy || !chosen.length} onClick={markPaid}>{busy ? "Saving…" : "Mark paid"}</Button>
            </Hint>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
