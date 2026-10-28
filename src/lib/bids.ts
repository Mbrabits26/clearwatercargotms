// Bid Desk data access (browser client, RLS applies) + actions shared by the Bid Desk screens.
import { queryOptions } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { laneStats } from "@/components/RateView";
import { postLowMarginNotice } from "@/lib/buyBox";
import { LOW_PCT } from "@/lib/buyBox";
import type { Load } from "@/lib/tms";
import { usd } from "@/lib/tms";
import { accList, bidSheetRows, bidStatusFromLanes, estimateCarrierCost, laneTotals, priceLane, type BidKind, type OutField } from "@/lib/bidDesk";

export type Bid = Tables<"bids">;
export type BidLane = Tables<"bid_lanes">;

export const bidsQuery = queryOptions({
  queryKey: ["bids"],
  queryFn: async () => {
    const { data, error } = await supabase.from("bids").select("*").order("created_at", { ascending: false }).limit(1000);
    if (error) throw error;
    return data;
  },
});

/** Lane rollup per bid for the list (counts + won/lost), paged past the 1000-row cap. */
export const bidLaneSummaryQuery = queryOptions({
  queryKey: ["bid-lanes", "summary"],
  queryFn: async () => {
    const out: Pick<BidLane, "bid_id" | "status" | "linehaul" | "miles" | "fsc_per_mile" | "accessorials" | "loads_per_week" | "carrier_cost">[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("bid_lanes").select("bid_id, status, linehaul, miles, fsc_per_mile, accessorials, loads_per_week, carrier_cost").range(from, from + 999);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return out;
  },
});

export const bidQuery = (id: string) => queryOptions({
  queryKey: ["bids", id],
  queryFn: async () => {
    const { data, error } = await supabase.from("bids").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },
});

export const bidLanesQuery = (id: string) => queryOptions({
  queryKey: ["bid-lanes", id],
  queryFn: async () => {
    const out: BidLane[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("bid_lanes").select("*").eq("bid_id", id).order("position").range(from, from + 999);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return out;
  },
});

export const laneLabel = (l: Pick<BidLane, "origin_city" | "origin_state" | "dest_city" | "dest_state">) =>
  `${[l.origin_city, l.origin_state].filter(Boolean).join(", ")} → ${[l.dest_city, l.dest_state].filter(Boolean).join(", ")}`;

export const placeText = (city: string, state: string, zip: string | null) => (zip ? `${zip}` : [city, state].filter(Boolean).join(", "));

/** Lane history (our own loads, company-wide) used for pricing. */
export function historyFor(loads: Load[], l: Pick<BidLane, "origin_city" | "origin_state" | "dest_city" | "dest_state" | "equipment" | "miles">) {
  const s = laneStats(loads, { origin_city: l.origin_city, origin_state: l.origin_state, dest_city: l.dest_city, dest_state: l.dest_state, equipment: l.equipment, miles: l.miles }, false);
  const w = s.d365 ?? s.d90 ?? s.d30;
  return w ? { revRpm: w.revCpm, costRpm: w.costCpm, n: w.n } : null;
}

/** Re-derive the bid's status from its lanes' won/lost results. */
export async function refreshBidStatus(bidId: string) {
  const [{ data: bid }, { data: lanes }] = await Promise.all([
    supabase.from("bids").select("status").eq("id", bidId).maybeSingle(),
    supabase.from("bid_lanes").select("status").eq("bid_id", bidId),
  ]);
  if (!bid) return;
  const next = bidStatusFromLanes(lanes ?? [], bid.status);
  if (next !== bid.status) await supabase.from("bids").update({ status: next }).eq("id", bidId);
}

/** Price one lane at the target margin. Returns an error message when it can't be priced. */
export async function priceOne(l: BidLane, bid: Bid, loads: Load[], marginPct: number, overwrite: boolean): Promise<string | null> {
  if (!overwrite && Number(l.linehaul) > 0) return null;
  const h = historyFor(loads, l);
  const est = estimateCarrierCost(l, bid.kind as BidKind, h?.costRpm ?? null);
  const cost = Number(l.carrier_cost) > 0 && !overwrite ? Number(l.carrier_cost) : est.cost ?? (Number(l.carrier_cost) || 0);
  if (!(Number(l.miles) > 0)) return `${laneLabel(l)}: add miles first`;
  const p = priceLane(l, cost, Number(bid.fsc_per_mile), marginPct);
  if (!p) return `${laneLabel(l)}: no carrier cost yet — get market rates or type one in`;
  const { error } = await supabase.from("bid_lanes").update({
    ...p, history_rpm: h?.revRpm ?? null, history_cost_rpm: h?.costRpm ?? null, history_n: h?.n ?? 0,
  }).eq("id", l.id);
  return error ? `${laneLabel(l)}: ${error.message}` : null;
}

const quoteNote = (l: BidLane, bid: Bid) => {
  const t = laneTotals(l, Number(bid.fsc_per_mile));
  const acc = accList(l.accessorials).map((a) => `${a.type} ${usd(a.amount)}`).join(", ");
  return [`${bid.bid_number}${bid.name ? ` · ${bid.name}` : ""}`, `Linehaul ${usd(t.linehaul)}`, t.fsc ? `FSC ${usd(t.fsc)} ($${t.fscRpm.toFixed(2)}/mi)` : null, acc ? `Accessorials: ${acc}` : null, l.volume ? `Volume: ${l.volume}` : null].filter(Boolean).join(" · ");
};

/** Saves a priced lane as a quote (all-in rate; the breakdown goes in the notes). */
export async function laneToQuote(l: BidLane, bid: Bid): Promise<string | null> {
  if (l.quote_id) return null;
  const t = laneTotals(l, Number(bid.fsc_per_mile));
  if (!(t.linehaul > 0)) return `${laneLabel(l)}: not priced yet`;
  if (!l.origin_city || !l.dest_city) return `${laneLabel(l)}: needs origin and destination cities`;
  const expires = new Date(Date.now() + (bid.kind === "contract" ? 30 : 1) * 86400_000).toISOString();
  const { data, error } = await supabase.from("quotes").insert({
    customer_id: bid.customer_id, customer_name: bid.customer_name || bid.name, customer_email: bid.customer_email, kind: bid.kind,
    origin_city: l.origin_city, origin_state: l.origin_state, dest_city: l.dest_city, dest_state: l.dest_state,
    equipment: l.equipment, miles: l.miles, pickup_date: l.pickup_date, rate: t.allIn,
    target_carrier_rate: t.carrier > 0 ? t.carrier : null, notes: quoteNote(l, bid), expires_at: expires,
  }).select("id").single();
  if (error) return `${laneLabel(l)}: ${error.message}`;
  await supabase.from("bid_lanes").update({ quote_id: data.id }).eq("id", l.id);
  return null;
}

/** One Team chat notice for any low-margin lanes just saved as quotes (no approval block). */
export async function noticeLowLanes(lanes: BidLane[], bid: Bid, who: string) {
  const low = lanes.map((l) => ({ l, t: laneTotals(l, Number(bid.fsc_per_mile)) })).filter(({ t }) => t.health === "low");
  if (!low.length) return;
  if (low.length === 1) {
    const { l, t } = low[0]!;
    await postLowMarginNotice({ kind: "Quote", label: `${bid.bid_number} ${bid.customer_name ?? bid.name}`, lane: laneLabel(l), customer: t.allIn, carrier: t.carrier, who });
    return;
  }
  await supabase.from("chat_messages").insert({ channel: "team", body: `⚠️ Low margin bid ${bid.bid_number} (${bid.customer_name ?? bid.name}): ${low.length} lanes saved by ${who} below ${LOW_PCT}% margin — ${low.slice(0, 5).map(({ l, t }) => `${laneLabel(l)} ${t.pct.toFixed(1)}%`).join("; ")}${low.length > 5 ? "…" : ""}` });
}

/** Creates a Dispatch load from a won lane. */
export async function laneToLoad(l: BidLane, bid: Bid): Promise<string | null> {
  if (l.load_id) return null;
  const t = laneTotals(l, Number(bid.fsc_per_mile));
  if (!l.origin_city || !l.dest_city) return `${laneLabel(l)}: needs origin and destination cities`;
  const { data, error } = await supabase.from("loads").insert({
    customer_id: bid.customer_id, origin_city: l.origin_city, origin_state: l.origin_state,
    dest_city: l.dest_city, dest_state: l.dest_state, equipment: l.equipment, miles: l.miles,
    customer_rate: t.allIn, carrier_rate: t.carrier, pickup_at: l.pickup_date ? `${l.pickup_date}T08:00` : null,
  }).select("id").single();
  if (error) return `${laneLabel(l)}: ${error.message}`;
  await supabase.from("bid_lanes").update({ load_id: data.id, status: "won" }).eq("id", l.id);
  return null;
}

/** The returned bid sheet as an .xlsx file. */
export function bidSheetBlob(bid: Bid, lanes: BidLane[], outMap: Partial<Record<OutField, string>>) {
  const headers = Array.isArray(bid.source_headers) ? (bid.source_headers as string[]) : [];
  const { headers: cols, rows } = bidSheetRows(headers, lanes, Number(bid.fsc_per_mile), outMap);
  const ws = XLSX.utils.json_to_sheet(rows, { header: cols });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clearwater Bid");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const filename = `Clearwater-Cargo-${bid.bid_number}${bid.customer_name ? `-${bid.customer_name.replace(/[^A-Za-z0-9]+/g, "-")}` : ""}.xlsx`;
  return { filename, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) };
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const myName = async () => {
  const { data } = await supabase.auth.getUser();
  return (data.user?.user_metadata?.full_name as string) || data.user?.email || "a user";
};
