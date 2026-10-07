import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Globe, RefreshCw } from "lucide-react";
import { getMarketRates, type MarketRate } from "@/lib/market.functions";
import { loadTotals, usd, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Lane = { origin_city?: string | null; origin_state: string; dest_city?: string | null; dest_state: string; equipment: string; miles?: number | null };

export function laneStats(loads: Load[], lane: Lane, exactCity: boolean) {
  const same = loads.filter((l) =>
    l.origin_state === lane.origin_state && l.dest_state === lane.dest_state && Number(l.customer_rate) > 0 &&
    (!exactCity || ((!lane.origin_city || l.origin_city.toLowerCase() === lane.origin_city.toLowerCase()) && (!lane.dest_city || l.dest_city.toLowerCase() === lane.dest_city.toLowerCase()))),
  );
  const win = (days: number) => {
    const s = same.filter((l) => Date.now() - new Date(l.pickup_at ?? l.created_at).getTime() < days * 86400_000);
    if (!s.length) return null;
    const rev = s.map((l) => loadTotals(l).revenue);
    const cost = s.map((l) => loadTotals(l).cost);
    const withMiles = s.filter((l) => (l.miles ?? 0) > 0);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const revCpm = withMiles.length ? avg(withMiles.map((l) => loadTotals(l).revenue / l.miles!)) : null;
    const costCpm = withMiles.length ? avg(withMiles.map((l) => loadTotals(l).cost / l.miles!)) : null;
    const byEq: Record<string, number[]> = {};
    s.forEach((l) => (byEq[l.equipment] ??= []).push(loadTotals(l).pct));
    return {
      n: s.length, rev: avg(rev), cost: avg(cost), revLow: Math.min(...rev), revHigh: Math.max(...rev),
      costLow: Math.min(...cost), costHigh: Math.max(...cost), revCpm, costCpm,
      pct: avg(rev) ? ((avg(rev) - avg(cost)) / avg(rev)) * 100 : 0,
      byEq: Object.entries(byEq).map(([k, v]) => ({ eq: k, pct: avg(v), n: v.length })),
    };
  };
  return { d30: win(30), d90: win(90), d365: win(365) };
}

export function RateView({ loads, lane, onApply }: { loads: Load[]; lane: Lane; onApply?: (customer: number, carrier: number) => void }) {
  const [exact, setExact] = useState(false);
  const [margin, setMargin] = useState("15");
  const stats = useMemo(() => laneStats(loads, lane, exact), [loads, lane, exact]);
  const best = stats.d90 ?? stats.d365 ?? stats.d30;
  const miles = lane.miles ?? 0;
  const market = useMarket(lane);

  // Pricing: base carrier cost on history (or market spot), then mark up to target margin.
  const baseCost = best?.costCpm && miles ? best.costCpm * miles : best?.cost ?? (market.data?.spot_rpm && miles ? market.data.spot_rpm * miles : 0);
  const m = Math.min(60, Math.max(0, Number(margin) || 0)) / 100;
  const sellPrice = baseCost ? baseCost / (1 - m) : 0;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{lane.origin_city ? `${lane.origin_city}, ` : ""}{lane.origin_state} → {lane.dest_city ? `${lane.dest_city}, ` : ""}{lane.dest_state} · {lane.equipment}</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} />Exact cities only (otherwise state to state)</label>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {(["d30", "d90", "d365"] as const).map((k) => {
          const w = stats[k];
          return (
            <div key={k} className="rounded border p-2">
              <div className="text-xs uppercase text-muted-foreground">{k === "d30" ? "30 days" : k === "d90" ? "90 days" : "12 months"}{w ? ` · ${w.n} loads` : ""}</div>
              {w ? (
                <div className="mt-1 space-y-0.5">
                  <div className="flex justify-between"><span>All-in (customer)</span><b>{usd(w.rev)}</b></div>
                  <div className="text-[11px] text-muted-foreground">low {usd(w.revLow)} · high {usd(w.revHigh)}{w.revCpm ? ` · $${w.revCpm.toFixed(2)}/mi` : ""}</div>
                  <div className="flex justify-between"><span>Carrier pay</span><b>{usd(w.cost)}</b></div>
                  <div className="text-[11px] text-muted-foreground">low {usd(w.costLow)} · high {usd(w.costHigh)}{w.costCpm ? ` · $${w.costCpm.toFixed(2)}/mi` : ""}</div>
                  <div className="flex justify-between text-gold"><span>Margin</span><b>{w.pct.toFixed(1)}%</b></div>
                  {w.byEq.length > 1 && <div className="text-[11px] text-muted-foreground">{w.byEq.map((e) => `${e.eq} ${e.pct.toFixed(0)}%`).join(" · ")}</div>}
                </div>
              ) : <div className="mt-1 text-muted-foreground">No Clearwater history.</div>}
            </div>
          );
        })}
      </div>

      <div className="rounded border border-dashed p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs uppercase text-muted-foreground"><Globe className="h-3.5 w-3.5" />Public market estimate</div>
          <Button size="sm" variant="outline" disabled={market.loading} onClick={() => market.run(!!market.data)}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${market.loading ? "animate-spin" : ""}`} />{market.data ? "Refresh" : "Market rates"}
          </Button>
        </div>
        {market.error && <div className="mt-1 text-xs text-warning">{market.error}</div>}
        {market.data && (
          <div className="mt-1 space-y-1">
            <div className="flex gap-4">
              <div>Spot: <b>{market.data.spot_rpm ? `$${market.data.spot_rpm.toFixed(2)}/mi` : "—"}</b>{market.data.spot_rpm && miles ? ` (${usd(market.data.spot_rpm * miles)})` : ""}</div>
              <div>Contract: <b>{market.data.contract_rpm ? `$${market.data.contract_rpm.toFixed(2)}/mi` : "—"}</b>{market.data.contract_rpm && miles ? ` (${usd(market.data.contract_rpm * miles)})` : ""}</div>
            </div>
            <div className="text-xs text-muted-foreground">{market.data.scope}{market.data.as_of ? ` · as of ${market.data.as_of}` : ""} — {market.data.summary}</div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              {market.data.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-gold underline" title={s.note}>{s.title.slice(0, 40)}</a>)}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded border p-2">
        <span className="font-semibold">Price this load</span>
        <span className="text-xs text-muted-foreground">Target margin</span>
        <Input className="h-8 w-16" type="number" value={margin} onChange={(e) => setMargin(e.target.value)} />%
        {baseCost ? (
          <>
            <span>Carrier target <b>{usd(baseCost)}</b></span>
            <span>Customer price <b className="text-gold">{usd(sellPrice)}</b>{miles ? ` ($${(sellPrice / miles).toFixed(2)}/mi)` : ""}</span>
            {onApply && <Button size="sm" onClick={() => onApply(Math.round(sellPrice), Math.round(baseCost))}>Use these rates</Button>}
          </>
        ) : <span className="text-xs text-muted-foreground">Need lane history or market rates (and miles) to price.</span>}
      </div>
    </div>
  );
}

function useMarket(lane: Lane) {
  const fn = useServerFn(getMarketRates);
  const [data, setData] = useState<MarketRate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async (refresh = false) => {
    if (lane.origin_state.length !== 2 || lane.dest_state.length !== 2) return setError("Enter origin and destination states first.");
    setLoading(true); setError(null);
    try {
      const r = await fn({ data: { origin_state: lane.origin_state, dest_state: lane.dest_state, equipment: lane.equipment, refresh } });
      setData(r.result); setError(r.error);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  };
  return { data, error, loading, run };
}
