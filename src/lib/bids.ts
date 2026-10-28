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
import { accList, bidSheetRows, bidStatusFromLanes, costRpm, counterLadder, counterList, estimateCarrierCost, laneTotals, offerRpm, priceLane, sheetWrites, type BidKind, type OutField, type SheetTable } from "@/lib/bidDesk";

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

export const laneLabel = (l: Pick<BidLane, "origin_city" | "origin_state" | "dest_city" | "dest_state"> & { mileage_band?: string | null }) =>
  `${[l.origin_city, l.origin_state].filter(Boolean).join(", ")} → ${[l.dest_city, l.dest_state].filter(Boolean).join(", ") || (l.mileage_band ? `any stop ${l.mileage_band} mi` : "—")}`;

export const bidTables = (bid: Pick<Bid, "source_tables">): SheetTable[] => (Array.isArray(bid.source_tables) ? (bid.source_tables as unknown as SheetTable[]) : []);

/** Builds the counteroffer plan for one lane (suggestion only — nothing saved). */
export function ladderFor(l: BidLane, bid: Bid, historyCostRpm: number | null | undefined) {
  const c = costRpm(l, bid.kind as BidKind, historyCostRpm);
  return { cost: c, ladder: counterLadder({ offer: offerRpm(l), cost: c.rpm, targetPct: Number(bid.target_margin) || 15, belowPct: bid.offer_below_pct == null ? null : Number(bid.offer_below_pct) }) };
}

/** Saves the suggested counters on a lane; also prices an unpriced lane at counter 1 when miles are known. */
export async function saveCounters(l: BidLane, bid: Bid, loads: Load[], overwrite: boolean): Promise<string | null> {
  if (!overwrite && counterList(l.counters).some(Boolean)) return null;
  const h = historyFor(loads, l);
  const { cost, ladder } = ladderFor(l, bid, h?.costRpm ?? null);
  if (!ladder.counters.length) return `${laneLabel(l)}: ${ladder.note}`;
  const patch: Partial<BidLane> = { counters: ladder.counters as never, history_rpm: h?.revRpm ?? null, history_cost_rpm: h?.costRpm ?? null, history_n: h?.n ?? 0 };
  const miles = Number(l.miles);
  if (miles > 0 && (overwrite || !(Number(l.linehaul) > 0))) {
    const t = laneTotals({ ...l, linehaul: 0 }, Number(bid.fsc_per_mile));
    patch.linehaul = Math.max(0, Math.round(ladder.counters[0]! * miles - t.fsc - t.acc));
    if (!(Number(l.carrier_cost) > 0) && cost.rpm) patch.carrier_cost = Math.round(cost.rpm * miles);
  }
  const { error } = await supabase.from("bid_lanes").update(patch as never).eq("id", l.id);
  return error ? `${laneLabel(l)}: ${error.message}` : null;
}

/** Stores the shipper's original workbook so our numbers can go back into it. */
export async function uploadBidFile(bidId: string, file: File): Promise<string | null> {
  const path = `${bidId}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
  const { error } = await supabase.storage.from("bid-files").upload(path, file, { contentType: file.type || "application/octet-stream" });
  return error ? null : path;
}

export const placeText = (city: string, state: string, zip: string | null) => (zip ? `${zip}` : [city, state].filter(Boolean).join(", "));

/** Lane history (our own loads, company-wide) used for pricing. */
export function historyFor(loads: Load[], l: Pick<BidLane, "origin_city" | "origin_state" | "dest_city" | "dest_state" | "equipment" | "miles">) {
  // Per-mile rates swing hard with distance, so only compare loads of a similar length
  // (lanes with no miles are state-rate lanes and compare to our 250+ mile loads).
  const miles = Number(l.miles) || 0;
  const near = loads.filter((x) => { const m = Number(x.miles) || 0; return miles > 0 ? m > 0 && Math.abs(m - miles) <= Math.max(40, miles * 0.3) : m >= 250; });
  const s = laneStats(near, { origin_city: l.origin_city, origin_state: l.origin_state, dest_city: l.dest_city, dest_state: l.dest_state, equipment: l.equipment, miles: l.miles }, false);
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

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type BidFile = { filename: string; mime: string; blob: Blob };
const fileBase = (bid: Bid) => `Clearwater-Cargo-${bid.bid_number}${bid.customer_name ? `-${bid.customer_name.replace(/[^A-Za-z0-9]+/g, "-")}` : ""}`;

/**
 * The returned bid sheet(s). When the shipper's workbook was uploaded, our numbers go into its own cells
 * (every sheet kept); typed lanes go on an extra "Clearwater lanes" sheet. Otherwise a clean sheet is made.
 */
export async function bidFiles(bid: Bid, lanes: BidLane[], outMap: Partial<Record<OutField, string>>): Promise<BidFile[]> {
  const fsc = Number(bid.fsc_per_mile);
  const tables = bidTables(bid);
  const paths = [...new Set(tables.map((t) => t.path).filter((p): p is string => !!p))];
  const files: BidFile[] = [];
  const loose = lanes.filter((l) => !l.source_table || !tables.some((t) => t.key === l.source_table && t.path));
  for (const [i, path] of paths.entries()) {
    const { data, error } = await supabase.storage.from("bid-files").download(path);
    if (error || !data) continue;
    const src = await data.arrayBuffer();
    const writes = sheetWrites(tables.filter((t) => t.path === path), lanes, fsc);
    const extra = i === 0 && loose.length ? bidSheetRows([], loose, fsc, {}) : null;
    let buf: ArrayBuffer;
    if (/\.xlsx$/i.test(path)) {
      // ExcelJS keeps the customer's colors, column widths, merged notes and formulas.
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(src);
      for (const w of writes) { const ws = wb.getWorksheet(w.sheet); if (ws) ws.getCell(w.r + 1, w.c + 1).value = w.v; }
      if (extra) { const ws = wb.addWorksheet("Clearwater lanes"); ws.addRow(extra.headers); extra.rows.forEach((r) => ws.addRow(extra.headers.map((h) => r[h] ?? ""))); }
      buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    } else {
      const wb = XLSX.read(src);
      for (const w of writes) { const ws = wb.Sheets[w.sheet]; if (ws) XLSX.utils.sheet_add_aoa(ws, [[w.v]], { origin: { r: w.r, c: w.c } }); }
      if (extra) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(extra.rows, { header: extra.headers }), "Clearwater lanes");
      buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    }
    const orig = path.split("/").pop()!.replace(/^\d+-/, "").replace(/\.(xlsx|xls|csv)$/i, "");
    files.push({ filename: `${fileBase(bid)}-${orig}.xlsx`, mime: XLSX_MIME, blob: new Blob([buf], { type: XLSX_MIME }) });
  }
  if (files.length) return files;
  const headers = Array.isArray(bid.source_headers) ? (bid.source_headers as string[]) : [];
  const { headers: cols, rows } = bidSheetRows(headers, lanes, fsc, outMap);
  const ws = XLSX.utils.json_to_sheet(rows, { header: cols });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clearwater Bid");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return [{ filename: `${fileBase(bid)}.xlsx`, mime: XLSX_MIME, blob: new Blob([buf], { type: XLSX_MIME }) }];
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
