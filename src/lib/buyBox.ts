import { supabase } from "@/integrations/supabase/client";

/** Margin health bands: healthy at or above HEALTHY_PCT, low below LOW_PCT (team chat notice). */
export const HEALTHY_PCT = 15;
export const LOW_PCT = 8;
export const TARGETS = [12, 15, 18, 20];

export type Health = "healthy" | "moderate" | "low" | "none";

export function buyBox(customer: number, carrier: number, miles: number) {
  const margin = customer - carrier;
  const pct = customer > 0 ? (margin / customer) * 100 : 0;
  const per = (v: number) => (miles > 0 ? v / miles : null);
  const health: Health = customer <= 0 || carrier <= 0 ? "none" : pct >= HEALTHY_PCT ? "healthy" : pct >= LOW_PCT ? "moderate" : "low";
  return { margin, pct, health, custRpm: per(customer), carrRpm: per(carrier), netRpm: per(margin) };
}

/** Highest carrier pay that still hits the target margin %. */
export const maxCarrierPay = (customer: number, pct: number) => Math.floor(customer * (1 - pct / 100));
/** Sell rate needed to hit the target margin % on a known carrier cost. */
export const sellForMargin = (carrier: number, pct: number) => Math.ceil(carrier / (1 - pct / 100));

/** Contract lane projection: weekly/annual gross profit, with an optional per-mile buffer added to carrier cost. */
export function contractProjection(customer: number, carrier: number, miles: number, perWeek: number, bufferRpm: number) {
  const bufferedCarrier = carrier + Math.max(0, bufferRpm) * Math.max(0, miles);
  const perLoad = customer - bufferedCarrier;
  const weekly = perLoad * Math.max(0, perWeek);
  return { bufferedCarrier, perLoad, weekly, annual: weekly * 52 };
}

/** Post a low-margin notice to Team chat (no approval block). Skips fleet loads and loads without rates. */
export async function postLowMarginNotice(p: {
  label: string; lane: string; customer: number; carrier: number; who: string; fleet?: boolean; kind?: "Load" | "Quote";
}) {
  if (p.fleet) return;
  const b = buyBox(p.customer, p.carrier, 0);
  if (b.health !== "low") return;
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const body = `⚠️ Low margin ${p.kind ?? "Load"}: ${p.label} (${p.lane}) saved by ${p.who} at ${b.pct.toFixed(1)}% margin (${usd(b.margin)} on ${usd(p.customer)} revenue, ${usd(p.carrier)} carrier pay).`;
  await supabase.from("chat_messages").insert({ channel: "team", body });
}
