import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { HEALTHY_PCT, LOW_PCT, TARGETS, buyBox, contractProjection, maxCarrierPay, sellForMargin } from "@/lib/buyBox";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const rpm = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}/mi`);

/** Live margin & ROI buy box: margin health, RPMs, target chips, and a contract-lane projection. */
export function BuyBox({ customer, carrier, miles, fleet, onCarrier, onCustomer }: {
  customer: number; carrier: number; miles: number; fleet?: boolean;
  onCarrier?: (v: number) => void; onCustomer?: (v: number) => void;
}) {
  const [mode, setMode] = useState<"spot" | "contract">("spot");
  const [perWeek, setPerWeek] = useState("3");
  const [buffer, setBuffer] = useState("0.15");
  if (fleet) return <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">Asset / Fleet load (Foust Farms) — internal, no brokerage margin.</div>;
  const b = buyBox(customer, carrier, miles);
  const tone = { healthy: "border-success/50 bg-success/10 text-success", moderate: "border-warning/50 bg-warning/10 text-warning", low: "border-destructive/50 bg-destructive/10 text-destructive", none: "border-border text-muted-foreground" }[b.health];
  const label = { healthy: "Healthy", moderate: "Moderate", low: "Low margin — team will be notified", none: "Enter rates" }[b.health];
  const proj = contractProjection(customer, carrier, miles, Number(perWeek) || 0, Number(buffer) || 0);
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-sm font-bold uppercase tracking-wider text-gold">Buy box · margin & ROI</span>
        <div className="flex gap-1 text-xs">
          {(["spot", "contract"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cn("rounded px-2 py-0.5 capitalize", mode === m ? "bg-primary text-primary-foreground" : "border text-muted-foreground")}>{m}</button>
          ))}
        </div>
      </div>
      <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5", tone)}>
        <b>{b.health === "none" ? "—" : `${usd(b.margin)} · ${b.pct.toFixed(1)}%`}</b>
        <span className="text-xs">{label}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div><div className="text-muted-foreground">Customer RPM</div><b>{rpm(b.custRpm)}</b></div>
        <div><div className="text-muted-foreground">Carrier RPM</div><b>{rpm(b.carrRpm)}</b></div>
        <div><div className="text-muted-foreground">Net / mile</div><b className="text-gold">{rpm(b.netRpm)}</b></div>
      </div>
      {customer > 0 && (
        <div className="text-xs">
          <div className="mb-1 text-muted-foreground">Max carrier pay to hit target (click to use):</div>
          <div className="flex flex-wrap gap-1">
            {TARGETS.map((t) => (
              <button key={t} type="button" disabled={!onCarrier} onClick={() => onCarrier?.(maxCarrierPay(customer, t))} className="rounded border px-2 py-0.5 hover:border-gold">{t}% · {usd(maxCarrierPay(customer, t))}</button>
            ))}
          </div>
        </div>
      )}
      {carrier > 0 && (
        <div className="text-xs">
          <div className="mb-1 text-muted-foreground">Sell rate to bid (win · target · premium):</div>
          <div className="flex flex-wrap gap-1">
            {TARGETS.map((t) => (
              <button key={t} type="button" disabled={!onCustomer} onClick={() => onCustomer?.(sellForMargin(carrier, t))} className="rounded border px-2 py-0.5 hover:border-gold">{t}% · {usd(sellForMargin(carrier, t))}</button>
            ))}
          </div>
        </div>
      )}
      {mode === "contract" && (
        <div className="space-y-1 border-t pt-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-muted-foreground">Loads per week<Input type="number" min={0} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} /></label>
            <label className="text-muted-foreground">Fuel/season buffer ($/mi)<Input type="number" step="0.05" min={0} value={buffer} onChange={(e) => setBuffer(e.target.value)} /></label>
          </div>
          {miles > 0 ? null : <div className="text-warning">Add miles to apply the per-mile buffer.</div>}
          <div>Buffered carrier cost {usd(proj.bufferedCarrier)} · profit/load <b>{usd(proj.perLoad)}</b></div>
          <div>Weekly <b>{usd(proj.weekly)}</b> · Annual <b className="text-gold">{usd(proj.annual)}</b></div>
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">Healthy ≥ {HEALTHY_PCT}% · Moderate {LOW_PCT}–{HEALTHY_PCT}% · Low &lt; {LOW_PCT}% posts a Team chat notice on save.</div>
    </div>
  );
}
