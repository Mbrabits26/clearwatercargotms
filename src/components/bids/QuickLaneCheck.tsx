import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Globe, MapPin, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMarketRates, type MarketRate } from "@/lib/market.functions";
import { drivingMiles } from "@/lib/places.functions";
import { laneHistoryQuery } from "@/lib/queries";
import { EQUIPMENT, usd } from "@/lib/tms";
import { estimateCarrierCost, laneTotals, priceLane, splitPlace, type BidAcc, type BidKind } from "@/lib/bidDesk";
import { historyFor } from "@/lib/bids";
import { TARGETS } from "@/lib/buyBox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AccList } from "./AccEditor";

const rpm = (n: number | null | undefined) => (n ? `$${n.toFixed(2)}/mi` : "—");
export const HEALTH_TONE = { healthy: "text-success", moderate: "text-warning", low: "text-destructive", none: "text-muted-foreground" } as const;

/** One-lane market check: miles, our history, public market, then FSC/accessorials and the bid at a target margin. */
export function QuickLaneCheck() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: loads = [] } = useQuery(laneHistoryQuery());
  const miles$ = useServerFn(drivingMiles);
  const market$ = useServerFn(getMarketRates);
  const [f, setF] = useState({ origin: "", dest: "", equipment: "Dry Van", kind: "spot" as BidKind, miles: "", fsc: "0", margin: "15", carrier: "", linehaul: "" });
  const [acc, setAcc] = useState<BidAcc[]>([]);
  const [mkt, setMkt] = useState<MarketRate | null>(null);
  const [busy, setBusy] = useState("");
  const o = splitPlace(f.origin), d = splitPlace(f.dest);
  const ok = /^[A-Z]{2}$/.test(o.state) && /^[A-Z]{2}$/.test(d.state);
  const lane = { origin_city: o.city, origin_state: o.state, dest_city: d.city, dest_state: d.state, equipment: f.equipment, miles: Number(f.miles) || null };
  const hist = useMemo(() => (ok ? historyFor(loads, lane) : null), [loads, ok, lane.origin_city, lane.origin_state, lane.dest_city, lane.dest_state, lane.equipment, lane.miles]);
  const calcLane = { miles: Number(f.miles) || 0, fsc_per_mile: Number(f.fsc) || 0, accessorials: acc, linehaul: Number(f.linehaul) || 0, carrier_cost: Number(f.carrier) || 0, market_spot_rpm: mkt?.spot_rpm, market_contract_rpm: mkt?.contract_rpm };
  const t = laneTotals(calcLane, 0);
  const est = estimateCarrierCost(calcLane, f.kind, hist?.costRpm ?? null);

  const lookupMiles = async (auto = false) => {
    if (!ok) return;
    setBusy("miles");
    try {
      const r = await miles$({ data: { origin: f.origin, dest: f.dest } });
      if (r.miles) setF((s) => (auto && s.miles ? s : { ...s, miles: String(r.miles) })); else if (!auto) toast.error("Couldn't find driving miles for that lane.");
    } catch (e) { toast.error((e as Error).message); }
    setBusy("");
  };
  const lookupMarket = async () => {
    if (!ok) return;
    setBusy("market");
    try {
      const r = await market$({ data: { origin_state: o.state, dest_state: d.state, equipment: f.equipment } });
      if (r.error) toast.error(r.error); else setMkt(r.result);
    } catch (e) { toast.error((e as Error).message); }
    setBusy("");
  };
  const price = (margin: number) => {
    const cost = Number(f.carrier) || est.cost;
    if (!cost) return toast.error("Add miles and get market rates (or type a carrier cost) first.");
    const p = priceLane(calcLane, cost, 0, margin);
    if (p) setF((s) => ({ ...s, carrier: String(p.carrier_cost), linehaul: String(p.linehaul), margin: String(margin) }));
  };
  const saveAsBid = async () => {
    setBusy("save");
    const { data: bid, error } = await supabase.from("bids").insert({ name: `${f.origin} → ${f.dest}`, kind: f.kind, fsc_per_mile: Number(f.fsc) || 0, target_margin: Number(f.margin) || 15 }).select("id").single();
    if (error) { setBusy(""); return toast.error(error.message); }
    const { error: le } = await supabase.from("bid_lanes").insert({
      bid_id: bid.id, origin_city: o.city, origin_state: o.state, origin_zip: o.zip || null, dest_city: d.city, dest_state: d.state, dest_zip: d.zip || null,
      equipment: f.equipment, miles: Number(f.miles) || null, carrier_cost: Number(f.carrier) || null, linehaul: Number(f.linehaul) || null, accessorials: acc as never,
      market_spot_rpm: mkt?.spot_rpm ?? null, market_contract_rpm: mkt?.contract_rpm ?? null, market_note: mkt?.scope ?? null,
      history_rpm: hist?.revRpm ?? null, history_cost_rpm: hist?.costRpm ?? null, history_n: hist?.n ?? 0,
    });
    setBusy("");
    if (le) return toast.error(le.message);
    qc.invalidateQueries({ queryKey: ["bids"] });
    navigate({ to: "/bids", search: { bid: bid.id } });
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h2 className="font-display text-lg font-bold uppercase tracking-wider text-gold">Quick lane check</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input className="col-span-2" placeholder="From — City, ST" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} onBlur={() => !f.miles && f.dest && lookupMiles(true)} />
        <Input className="col-span-2" placeholder="To — City, ST" value={f.dest} onChange={(e) => setF({ ...f, dest: e.target.value })} onBlur={() => !f.miles && f.origin && lookupMiles(true)} />
        <select value={f.equipment} onChange={(e) => { setF({ ...f, equipment: e.target.value }); setMkt(null); }} className="h-9 rounded border bg-background px-2 text-sm">{EQUIPMENT.map((x) => <option key={x}>{x}</option>)}</select>
        <div className="flex gap-1 text-xs">
          {(["spot", "contract"] as const).map((k) => <button key={k} type="button" onClick={() => setF({ ...f, kind: k })} className={cn("flex-1 rounded px-2 capitalize", f.kind === k ? "bg-primary text-primary-foreground" : "border text-muted-foreground")}>{k}</button>)}
        </div>
        <div className="col-span-2 flex gap-1">
          <Input type="number" placeholder="Miles" value={f.miles} onChange={(e) => setF({ ...f, miles: e.target.value })} />
          <Button variant="outline" size="sm" className="h-9" disabled={!ok || !!busy} onClick={() => lookupMiles()} title="Look up driving miles"><MapPin className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" className="h-9" disabled={!ok || !!busy} onClick={lookupMarket}><Globe className="mr-1 h-4 w-4" />{busy === "market" ? "Checking…" : "Market"}</Button>
        </div>
      </div>
      {!ok && (f.origin || f.dest) && <p className="text-xs text-warning">Write each place as City, ST — for example Staley, NC.</p>}

      {ok && (
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded border p-2"><div className="text-muted-foreground">Our history (all brokers)</div>
            {hist ? <><div>Sell {rpm(hist.revRpm)} · Buy {rpm(hist.costRpm)}</div><div className="text-muted-foreground">{hist.n} loads</div></> : <div className="text-muted-foreground">No loads on this lane yet</div>}</div>
          <div className="rounded border p-2"><div className="text-muted-foreground">Public market</div>
            {mkt ? <><div>Spot {rpm(mkt.spot_rpm)} · Contract {rpm(mkt.contract_rpm)}</div><div className="truncate text-muted-foreground" title={mkt.summary}>{mkt.scope}</div></> : <div className="text-muted-foreground">Press Market to check</div>}</div>
          <div className="rounded border p-2"><div className="text-muted-foreground">Est. carrier cost</div>
            <div>{est.cost ? usd(est.cost) : "—"} <span className="text-muted-foreground">{est.source === "history" ? "from our loads" : est.source === "market" ? `from ${f.kind} market` : ""}</span></div></div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="text-muted-foreground">Carrier cost $ (all-in)<Input type="number" value={f.carrier} placeholder={est.cost ? String(est.cost) : ""} onChange={(e) => setF({ ...f, carrier: e.target.value })} /></label>
            <label className="text-muted-foreground">Fuel surcharge $/mi<Input type="number" step="0.01" value={f.fsc} onChange={(e) => setF({ ...f, fsc: e.target.value })} /></label>
            <label className="text-muted-foreground">Linehaul $ (our bid)<Input type="number" value={f.linehaul} onChange={(e) => setF({ ...f, linehaul: e.target.value })} /></label>
            <label className="text-muted-foreground">Target margin %<Input type="number" value={f.margin} onChange={(e) => setF({ ...f, margin: e.target.value })} /></label>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            <span className="text-muted-foreground">Price at:</span>
            {[...new Set([...TARGETS, Number(f.margin) || 15])].sort((a, b) => a - b).map((m) => <button key={m} type="button" onClick={() => price(m)} className="rounded border px-2 py-0.5 hover:border-gold">{m}%</button>)}
          </div>
          <div className="rounded border p-2"><div className="mb-1 text-xs text-muted-foreground">Accessorials</div><AccList value={acc} onChange={setAcc} /></div>
        </div>
        <div className="space-y-1 rounded border p-3 text-sm">
          <div className="flex justify-between"><span>Linehaul</span><b>{usd(t.linehaul)}</b></div>
          <div className="flex justify-between"><span>Fuel surcharge {t.miles ? `(${t.miles} mi × $${t.fscRpm.toFixed(2)})` : ""}</span><b>{usd(t.fsc)}</b></div>
          <div className="flex justify-between"><span>Accessorials</span><b>{usd(t.acc)}</b></div>
          <div className="flex justify-between border-t pt-1 text-base"><span>All-in to customer</span><b className="text-gold">{usd(t.allIn)}</b></div>
          <div className="flex justify-between text-xs text-muted-foreground"><span>All-in per mile</span><span>{rpm(t.allInRpm)}</span></div>
          <div className={cn("flex justify-between", HEALTH_TONE[t.health])}><span>Margin</span><b>{t.health === "none" ? "—" : `${usd(t.margin)} · ${t.pct.toFixed(1)}%`}</b></div>
          <Button className="mt-2 w-full" disabled={!ok || !!busy} onClick={saveAsBid}><Save className="mr-1 h-4 w-4" />Save as a {f.kind} bid</Button>
        </div>
      </div>
    </div>
  );
}
