// Bid Desk math + spreadsheet helpers (pure, browser-safe).
import { buyBox, LOW_PCT, sellForMargin, type Health } from "@/lib/buyBox";

export type BidAcc = { type: string; amount: number };
export type BidKind = "spot" | "contract";
export type LaneLike = {
  miles?: number | null;
  linehaul?: number | null;
  carrier_cost?: number | null;
  fsc_per_mile?: number | null;
  accessorials?: unknown;
  loads_per_week?: number | null;
  market_spot_rpm?: number | null;
  market_contract_rpm?: number | null;
  offer_rpm?: number | null;
  offer_flat?: number | null;
  counters?: unknown;
  agreed_rpm?: number | null;
};

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

export const accList = (a: unknown): BidAcc[] =>
  Array.isArray(a) ? a.filter((x) => x && typeof x === "object").map((x: any) => ({ type: String(x.type ?? ""), amount: num(x.amount) })) : [];

/** Saved counteroffers ($/mi), blanks dropped. */
export const counterList = (c: unknown): (number | null)[] =>
  Array.isArray(c) ? c.slice(0, 3).map((x) => (x == null || x === "" || !(Number(x) > 0) ? null : Number(x))) : [];

/** FSC per mile for a lane: the lane's own value, else the bid default. */
export const fscRate = (lane: LaneLike, bidFsc: number | null | undefined) => (lane.fsc_per_mile != null ? num(lane.fsc_per_mile) : num(bidFsc));

/** Customer all-in = linehaul + fuel surcharge (per mile × miles) + accessorials; margin vs. all-in carrier cost. */
export function laneTotals(lane: LaneLike, bidFsc: number | null | undefined) {
  const miles = num(lane.miles);
  const fscRpm = fscRate(lane, bidFsc);
  const fsc = round2(fscRpm * miles);
  const acc = accList(lane.accessorials).reduce((s, a) => s + a.amount, 0);
  const linehaul = num(lane.linehaul);
  const allIn = round2(linehaul + fsc + acc);
  const carrier = num(lane.carrier_cost);
  const b = buyBox(allIn, carrier, miles);
  const health: Health = linehaul > 0 && carrier > 0 ? b.health : "none";
  const perWeek = num(lane.loads_per_week);
  return {
    miles, fscRpm, fsc, acc, linehaul, allIn, carrier, margin: b.margin, pct: b.pct, health,
    allInRpm: miles > 0 ? allIn / miles : null,
    linehaulRpm: miles > 0 ? linehaul / miles : null,
    annualLoads: perWeek * 52,
    annualRevenue: allIn * perWeek * 52,
    annualProfit: health === "none" ? 0 : b.margin * perWeek * 52,
  };
}

/** Estimated all-in carrier cost: our own lane history first, then the public market rate for the bid type. */
export function estimateCarrierCost(lane: LaneLike, kind: BidKind, historyCostRpm: number | null | undefined): { cost: number | null; source: "history" | "market" | null } {
  const miles = num(lane.miles);
  if (miles <= 0) return { cost: null, source: null };
  if (historyCostRpm && historyCostRpm > 0) return { cost: Math.round(historyCostRpm * miles), source: "history" };
  const m = kind === "contract" ? lane.market_contract_rpm ?? lane.market_spot_rpm : lane.market_spot_rpm ?? lane.market_contract_rpm;
  if (m && m > 0) return { cost: Math.round(Number(m) * miles), source: "market" };
  return { cost: null, source: null };
}

/** Linehaul that makes the all-in hit the target margin on the given carrier cost (FSC and accessorials come out of it). */
export function priceLane(lane: LaneLike, carrierCost: number, bidFsc: number | null | undefined, marginPct: number) {
  if (!(carrierCost > 0)) return null;
  const t = laneTotals({ ...lane, linehaul: 0 }, bidFsc);
  const allIn = sellForMargin(carrierCost, marginPct);
  return { carrier_cost: Math.round(carrierCost), linehaul: Math.max(0, Math.round(allIn - t.fsc - t.acc)) };
}

// ---------- Shipper offers + counteroffers (all in all-in $ per mile) ----------

/** The shipper's offer in $/mi: their per-mile number, else their flat rate ÷ miles. */
export function offerRpm(lane: LaneLike): number | null {
  if (num(lane.offer_rpm) > 0) return num(lane.offer_rpm);
  const miles = num(lane.miles);
  if (num(lane.offer_flat) > 0 && miles > 0) return num(lane.offer_flat) / miles;
  return null;
}

/** What we expect to pay a carrier, per mile: typed carrier cost first, then our history, then the market rate. */
export function costRpm(lane: LaneLike, kind: BidKind, historyCostRpm: number | null | undefined): { rpm: number | null; source: "typed" | "history" | "market" | null } {
  const miles = num(lane.miles);
  if (num(lane.carrier_cost) > 0 && miles > 0) return { rpm: num(lane.carrier_cost) / miles, source: "typed" };
  if (historyCostRpm && historyCostRpm > 0) return { rpm: historyCostRpm, source: "history" };
  const m = kind === "contract" ? lane.market_contract_rpm ?? lane.market_spot_rpm : lane.market_spot_rpm ?? lane.market_contract_rpm;
  if (m && Number(m) > 0) return { rpm: Number(m), source: "market" };
  return { rpm: null, source: null };
}

export type Verdict = "take" | "counter" | "walk" | "needcost";
export type Ladder = { target: number | null; floor: number | null; budget: number | null; counters: number[]; verdict: Verdict; note: string };

/**
 * Counteroffer plan in $/mi.
 * target = carrier cost at our target margin; floor = carrier cost at the low-margin line (8%).
 * When the sheet says the opening offer sits N% below their budget, budget = offer ÷ (1 − N%).
 * Counter 1 opens at target (or their budget if that's lower), the last counter is the walk-away
 * (the floor, or their offer if it already clears the floor), and counter 2 splits the difference.
 */
export function counterLadder(p: { offer: number | null; cost: number | null; targetPct: number; belowPct?: number | null; floorPct?: number }): Ladder {
  const { offer, cost } = p;
  const budget = offer && p.belowPct && p.belowPct > 0 && p.belowPct < 100 ? round2(offer / (1 - p.belowPct / 100)) : null;
  if (!cost || cost <= 0) return { target: null, floor: null, budget, counters: [], verdict: "needcost", note: "Add a carrier cost or get market rates to build counters." };
  const floorPct = Math.min(p.floorPct ?? LOW_PCT, p.targetPct);
  const target = round2(cost / (1 - p.targetPct / 100));
  const floor = round2(cost / (1 - floorPct / 100));
  if (offer && offer >= target) return { target, floor, budget, counters: [round2(offer)], verdict: "take", note: `Their offer already clears your ${p.targetPct}% target.` };
  if (budget != null && budget < floor) return { target, floor, budget, counters: [floor], verdict: "walk", note: `Even their likely budget ($${budget.toFixed(2)}/mi) is under your ${floorPct}% floor.` };
  const c1 = budget != null ? Math.min(target, budget) : target;
  const last = Math.max(floor, offer ?? 0);
  if (c1 - last < 0.03) return { target, floor, budget, counters: [round2(Math.max(c1, last))], verdict: "counter", note: "One counter — there's little room between your ask and walk-away." };
  return { target, floor, budget, counters: [round2(c1), round2((c1 + last) / 2), round2(last)], verdict: "counter", note: offer ? `Open at ${round2(c1).toFixed(2)}, walk away under ${round2(last).toFixed(2)}.` : "No shipper offer on this lane — counters run from your target down to your floor." };
}

/** Margin % a per-mile rate makes on a per-mile carrier cost. */
export const rpmMargin = (rate: number, cost: number | null) => (cost && rate > 0 ? ((rate - cost) / rate) * 100 : null);

// ---------- Lane status ----------

/** Bid status from its lanes' won/lost results; undecided bids keep their draft/submitted status. */
export function bidStatusFromLanes(lanes: { status: string }[], current: string): string {
  if (!lanes.length) return current;
  const won = lanes.filter((l) => l.status === "won").length;
  const lost = lanes.filter((l) => l.status === "lost").length;
  if (won === lanes.length) return "won";
  if (lost === lanes.length) return "lost";
  if (won > 0) return "partial";
  return current === "won" || current === "lost" || current === "partial" ? "submitted" : current;
}

// ---------- Reading shipper spreadsheets ----------

/** Turns RFP volume text into loads per week. Bare numbers use the column heading, else are read as annual. */
export function volumeToWeekly(v: unknown, heading = ""): number | null {
  const s = String(v ?? "").toLowerCase();
  const m = s.replace(/,/g, "").match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  const unit = /[a-z]/.test(s) ? s : heading.toLowerCase();
  let w: number;
  if (/day|daily/.test(unit)) w = n * 5;
  else if (/week|wk/.test(unit)) w = n;
  else if (/month|\bmo\b/.test(unit)) w = (n * 12) / 52;
  else if (/quarter|qtr/.test(unit)) w = (n * 4) / 52;
  else w = n / 52;
  return Math.round(w * 100) / 100;
}

/** "Charlotte, NC 28202" / "Charlotte NC" / "28202" → parts. */
export function splitPlace(v: unknown): { city: string; state: string; zip: string } {
  const s = String(v ?? "").trim();
  const zip = s.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ?? "";
  const rest = s.replace(zip, "").replace(/\s+/g, " ").trim().replace(/,\s*$/, "");
  const m = rest.match(/^(.*?)[,\s]+([A-Za-z]{2})$/);
  if (m) return { city: m[1]!.replace(/,$/, "").trim(), state: m[2]!.toUpperCase(), zip };
  if (/^[A-Za-z]{2}$/.test(rest)) return { city: "", state: rest.toUpperCase(), zip };
  return { city: rest, state: "", zip };
}

/** "26-50" → 26..50, "301-higher" / "300+" → 301..open. */
export function parseBand(v: unknown): { lo: number; hi: number | null } | null {
  const s = String(v ?? "").replace(/,/g, "").toLowerCase();
  const r = s.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
  if (r) return { lo: Number(r[1]), hi: Number(r[2]) };
  const o = s.match(/(\d+(?:\.\d+)?)\s*(?:\+|-?\s*(?:higher|up|more|over|plus|and up))/);
  if (o) return { lo: Number(o[1]), hi: null };
  return null;
}

export const BID_FIELDS = {
  origin: "Origin (City, ST)", origin_city: "Origin city", origin_state: "Origin state", origin_zip: "Origin zip",
  dest: "Destination (City, ST)", dest_city: "Destination city", dest_state: "Destination state", dest_zip: "Destination zip",
  equipment: "Equipment", miles: "Miles", band: "Mileage band", volume: "Volume", pickup_date: "Pickup date",
  offer_rpm: "Shipper offer $/mi", offer_flat: "Shipper offer $ (flat)",
} as const;
export type BidField = keyof typeof BID_FIELDS;
export const OUT_FIELDS = {
  counter1: "Counteroffer 1", counter2: "Counteroffer 2", counter3: "Counteroffer 3", final: "Final / agreed rate",
  linehaul: "Linehaul $", fsc_rpm: "FSC $/mi", fsc: "FSC $", acc: "Accessorials $", all_in: "All-in $", rpm: "All-in $/mi",
} as const;
export type OutField = keyof typeof OUT_FIELDS;
const COUNTER_FIELDS: OutField[] = ["counter1", "counter2", "counter3", "final"];

/** A mapping is a sheet column, or a value typed in for every row. */
export type MapVal = string | { fixed: string };
export type FieldMap = Partial<Record<BidField, MapVal>>;

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const EXACT: Record<BidField | OutField, string[]> = {
  origin: ["origin", "from", "shipfrom", "originlocation", "pickup", "pickuplocation", "lanefrom"],
  origin_city: ["origincity", "fromcity", "shipcity", "shippercity", "pickupcity", "ocity"],
  origin_state: ["originstate", "originst", "fromstate", "fromst", "shipstate", "shipperstate", "pickupstate", "ost", "ostate"],
  origin_zip: ["originzip", "originpostal", "originpostalcode", "fromzip", "shipzip", "pickupzip", "ozip"],
  dest: ["destination", "dest", "to", "shipto", "destinationlocation", "delivery", "deliverylocation", "laneto"],
  dest_city: ["destcity", "destinationcity", "tocity", "consigneecity", "deliverycity", "dcity"],
  dest_state: ["deststate", "destinationstate", "destst", "tostate", "tost", "consigneestate", "deliverystate", "dst", "dstate", "state", "st"],
  dest_zip: ["destzip", "destinationzip", "destinationpostal", "destinationpostalcode", "tozip", "consigneezip", "deliveryzip", "dzip"],
  equipment: ["equipment", "equip", "equipmenttype", "mode", "trailer", "trailertype", "service"],
  miles: ["miles", "distance", "mileage", "loadedmiles", "totalmiles"],
  band: ["band", "mileageband", "mileband", "milerange", "mileagerange", "distanceband"],
  volume: ["volume", "annualvolume", "loads", "loadsperyear", "annualloads", "frequency", "loadsperweek", "weeklyvolume", "monthlyvolume", "estvolume"],
  pickup_date: ["pickupdate", "shipdate", "pudate", "date", "readydate"],
  offer_rpm: ["cpm", "offercpm", "targetcpm", "startcpm", "targetrpm", "offerrpm", "budgetrpm"],
  offer_flat: ["startrate", "targetrate", "offerrate", "budget", "shipperrate", "openingrate"],
  counter1: ["counteroffer1", "counter1", "round1", "counteroffer"],
  counter2: ["counteroffer2", "counter2", "round2"],
  counter3: ["counteroffer3", "counter3", "round3"],
  final: ["finalagreedrate", "finalrate", "agreedrate", "final", "awardedrate"],
  linehaul: ["linehaul", "linehaulrate", "flatrate", "baserate", "rate", "bidrate", "yourrate"],
  fsc_rpm: ["fsc", "fscpermile", "fuelpermile", "fuelsurcharge", "fuelsurchargepermile", "fscrpm"],
  fsc: ["fscamount", "fueltotal", "fscflat", "totalfuel"],
  acc: ["accessorials", "accessorial", "othercharges", "extras"],
  all_in: ["allin", "allinrate", "total", "totalrate", "totalcost", "allinrateusd"],
  rpm: ["rpm", "ratepermile", "permile", "allinrpm", "costpermile"],
};
// Extra "heading contains" words beyond the exact names (long exact names are also used as contains words).
const CONTAINS: Partial<Record<BidField | OutField, string[]>> = {
  offer_rpm: ["cpm", "startrpm"],
  offer_flat: ["startrate", "openingrate", "targetrate", "budget"],
  band: ["band"],
  final: ["final", "agreed", "awarded"],
};
const NO_CONTAINS = new Set(["state", "from", "rate"]);
const OUT_ONLY = /counter|final|agreed|awarded|clearwater|yourrate|round\d/;
const IN_ONLY = /negotiat|start|opening|budget|target|shipper|offercpm/;

/** Best guess of which sheet column feeds each field (exact heading match first, then "contains"). */
export function guessMapping(headers: string[]): Partial<Record<BidField | OutField, string>> {
  const out: Partial<Record<BidField | OutField, string>> = {};
  const used = new Set<string>();
  const inKeys = Object.keys(BID_FIELDS) as BidField[];
  const outKeys = Object.keys(OUT_FIELDS) as OutField[];
  const keys = [...inKeys, ...outKeys];
  const allowed = (k: BidField | OutField, n: string) => {
    const isIn = (inKeys as string[]).includes(k);
    if (isIn && OUT_ONLY.test(n)) return false;
    if (!isIn && IN_ONLY.test(n) && !/counter/.test(n)) return false;
    if (k === "miles" && /band|range/.test(n)) return false;
    return true;
  };
  for (const pass of ["exact", "contains"] as const) {
    for (const k of keys) {
      if (out[k]) continue;
      const words = pass === "exact" ? EXACT[k] : [...EXACT[k].filter((a) => a.length >= 4 && !NO_CONTAINS.has(a)), ...(CONTAINS[k] ?? [])];
      const hit = headers.find((h) => {
        if (used.has(h)) return false;
        const n = norm(h);
        if (!n || !allowed(k, n)) return false;
        return pass === "exact" ? words.includes(n) : words.some((a) => n.includes(a));
      });
      if (hit) { out[k] = hit; used.add(hit); }
    }
  }
  // Separate city/state columns beat a combined one.
  if (out.origin && out.origin_city && out.origin_state) delete out.origin;
  if (out.dest && out.dest_city && out.dest_state) delete out.dest;
  return out;
}

const PLACE_KEYS: BidField[] = ["origin", "origin_city", "origin_state", "origin_zip", "dest", "dest_city", "dest_state", "dest_zip", "band"];
const recognized = (cells: string[]) => {
  const m = guessMapping(cells);
  const all = Object.keys(m).length;
  const place = PLACE_KEYS.filter((k) => m[k]).length;
  return { all, place };
};

/** Finds the heading row: the first of the top 15 rows with two or more recognizable headings, one of them a place or band. */
export function findHeaderRow(grid: unknown[][]): number {
  for (let i = 0; i < Math.min(15, grid.length); i++) {
    const cells = (grid[i] ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
    const r = recognized(cells);
    if (r.all >= 2 && r.place >= 1) return i;
  }
  return 0;
}

export type SheetTable = {
  key: string; sheet: string; label: string; path?: string | null;
  headerRow: number; cols: number[]; headers: string[];
  out: Partial<Record<OutField, string>>;
};
export type TableRows = { table: SheetTable; rows: Record<string, unknown>[] };

const colName = (c: number) => { let s = ""; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };

/**
 * Splits a sheet into its tables. Side-by-side tables separated by a blank column become separate tables
 * when each one has its own place/band heading; otherwise the whole row is one table.
 * Each row carries its sheet row index as "__row".
 */
export function findTables(grid: unknown[][], sheet: string): TableRows[] {
  if (!grid.length) return [];
  const hr = findHeaderRow(grid);
  const head = grid[hr] ?? [];
  const width = Math.max(head.length, ...grid.slice(hr, hr + 50).map((r) => r.length));
  const blocks: number[][] = [];
  let cur: number[] = [];
  for (let c = 0; c < width; c++) {
    if (String(head[c] ?? "").trim()) cur.push(c);
    else if (cur.length) { blocks.push(cur); cur = []; }
  }
  if (cur.length) blocks.push(cur);
  const isTable = (cols: number[]) => { const r = recognized(cols.map((c) => String(head[c] ?? "").trim())); return r.all >= 2 && r.place >= 1; };
  const parts = blocks.length > 1 && blocks.every(isTable) ? blocks : [Array.from({ length: width }, (_, i) => i)];
  return parts.map((cols) => {
    const seen: Record<string, number> = {};
    const headers = cols.map((c) => {
      let s = String(head[c] ?? "").trim() || `Column ${colName(c)}`;
      const n = (seen[s] ?? 0) + 1; seen[s] = n; if (n > 1) s = `${s} (${n})`;
      return s;
    });
    const rows: Record<string, unknown>[] = [];
    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r] ?? [];
      if (!cols.some((c) => String(row[c] ?? "").trim())) continue;
      const o: Record<string, unknown> = { __row: r };
      cols.forEach((c, i) => { o[headers[i]!] = row[c] ?? ""; });
      rows.push(o);
    }
    const g = guessMapping(headers);
    const out = Object.fromEntries((Object.keys(OUT_FIELDS) as OutField[]).filter((k) => g[k]).map((k) => [k, g[k]])) as Partial<Record<OutField, string>>;
    const label = parts.length > 1 ? `${sheet} · columns ${colName(cols[0]!)}–${colName(cols[cols.length - 1]!)}` : sheet;
    return { table: { key: `${sheet}!${colName(cols[0]!)}`, sheet, label, headerRow: hr, cols, headers, out }, rows };
  });
}

/** Long text cells (instructions, notes, sources) anywhere in a sheet. */
export function sheetNotes(grid: unknown[][]): string[] {
  const out = new Set<string>();
  for (const row of grid) for (const c of row ?? []) { const s = String(c ?? "").trim(); if (s.length >= 50 && /[a-z]/i.test(s) && s.split(/\s+/).length >= 8) out.add(s); }
  return [...out];
}

/** An origin named in a heading or note, e.g. "Mileage from Lexington, NC" → "Lexington, NC". */
export function detectOrigin(texts: string[]): string | null {
  for (const t of texts) {
    const m = String(t).match(/\b(?:from|origin:?|ships? from|out of)\s+([A-Z][A-Za-z .'-]*?),?\s+([A-Z]{2})\b/);
    if (m) return `${m[1]!.trim()}, ${m[2]}`;
  }
  return null;
}

/** "Opening CPM is calculated at 15% below …" → 15. */
export function detectBelowPct(texts: string[]): number | null {
  for (const t of texts) {
    const m = String(t).match(/(\d+(?:\.\d+)?)\s*%\s*(?:below|under|less than|lower than|off)/i);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Default field map for a table: guessed columns, plus a typed origin when the sheet names one and has no origin column. */
export function defaultFieldMap(headers: string[], origin: string | null): FieldMap {
  const g = guessMapping(headers);
  const m: FieldMap = Object.fromEntries((Object.keys(BID_FIELDS) as BidField[]).filter((k) => g[k]).map((k) => [k, g[k]!]));
  if (origin && !m.origin && !m.origin_city && !m.origin_state) m.origin = { fixed: origin };
  // No equipment column: show a typed value the user can change before importing.
  if (!m.equipment) m.equipment = { fixed: "Dry Van" };
  return m;
}

const EQ: [RegExp, string][] = [[/reef|temp|refrig/i, "Reefer"], [/flat/i, "Flatbed"], [/step/i, "Step Deck"], [/power/i, "Power Only"], [/conest/i, "Conestoga"], [/hot ?shot/i, "Hotshot"], [/box/i, "Box Truck"], [/van|dry|53|ftl|tl/i, "Dry Van"]];
export const normEquipment = (v: unknown) => { const s = String(v ?? ""); return EQ.find(([r]) => r.test(s))?.[1] ?? (s.trim() || "Dry Van"); };

export type ParsedLane = {
  origin_city: string; origin_state: string; origin_zip: string | null;
  dest_city: string; dest_state: string; dest_zip: string | null;
  equipment: string; miles: number | null; volume: string | null; loads_per_week: number | null;
  pickup_date: string | null; original: Record<string, unknown>;
  mileage_band: string | null; offer_rpm: number | null; offer_flat: number | null; source_row: number | null;
};

const toDate = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400_000)).toISOString().slice(0, 10);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const money = (v: unknown) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return n > 0 ? n : null; };

/** Sheet rows → lanes using a column mapping (or typed values). Rows need an origin state and a destination state or mileage band. */
export function rowsToLanes(rows: Record<string, unknown>[], map: FieldMap): ParsedLane[] {
  const g = (r: Record<string, unknown>, k: BidField): unknown => {
    const m = map[k];
    if (m == null || m === "") return undefined;
    return typeof m === "string" ? r[m] : m.fixed;
  };
  const s = (v: unknown) => String(v ?? "").trim();
  return rows.map((r) => {
    const o = map.origin ? splitPlace(g(r, "origin")) : { city: "", state: "", zip: "" };
    const d = map.dest ? splitPlace(g(r, "dest")) : { city: "", state: "", zip: "" };
    const vol = g(r, "volume");
    const bandRaw = s(g(r, "band"));
    const band = parseBand(bandRaw);
    const miles = Number(String(g(r, "miles") ?? "").replace(/[^0-9.]/g, "")) || (band ? band.hi ?? band.lo : null) || null;
    const volHeading = typeof map.volume === "string" ? map.volume : "";
    const original = Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("__")));
    return {
      origin_city: s(g(r, "origin_city")) || o.city,
      origin_state: (s(g(r, "origin_state")) || o.state).toUpperCase().slice(0, 2),
      origin_zip: s(g(r, "origin_zip")) || o.zip || null,
      dest_city: s(g(r, "dest_city")) || d.city,
      dest_state: (s(g(r, "dest_state")) || d.state).toUpperCase().slice(0, 2),
      dest_zip: s(g(r, "dest_zip")) || d.zip || null,
      equipment: normEquipment(g(r, "equipment")),
      miles,
      volume: s(vol) || null,
      loads_per_week: vol == null || vol === "" ? null : volumeToWeekly(vol, volHeading),
      pickup_date: toDate(g(r, "pickup_date")),
      original,
      mileage_band: band ? bandRaw : null,
      offer_rpm: money(g(r, "offer_rpm")),
      offer_flat: money(g(r, "offer_flat")),
      source_row: typeof r.__row === "number" ? r.__row : null,
    };
  }).filter((l) => /^[A-Z]{2}$/.test(l.origin_state) && (/^[A-Z]{2}$/.test(l.dest_state) || !!l.mileage_band) && l.origin_city.length <= 60 && l.dest_city.length <= 60);
}

// ---------- Writing our numbers back ----------

type OutLane = LaneLike & { original?: unknown; origin_city: string; origin_state: string; dest_city: string; dest_state: string; equipment: string };

/** Our numbers for one lane. Counters go out per mile, or as flat dollars when the shipper offered a flat rate. */
export function laneOutValues(l: LaneLike, bidFsc: number): Partial<Record<OutField, number>> {
  const out: Partial<Record<OutField, number>> = {};
  const t = laneTotals(l, bidFsc);
  if (t.linehaul > 0) {
    out.linehaul = t.linehaul; out.fsc_rpm = round2(t.fscRpm); out.fsc = t.fsc; out.acc = round2(t.acc); out.all_in = t.allIn;
    if (t.allInRpm != null) out.rpm = round2(t.allInRpm);
  }
  const flat = !(num(l.offer_rpm) > 0) && num(l.offer_flat) > 0 && num(l.miles) > 0;
  const fmt = (rpm: number) => (flat ? Math.round(rpm * num(l.miles)) : round2(rpm));
  counterList(l.counters).forEach((c, i) => { if (c) out[(["counter1", "counter2", "counter3"] as const)[i]!] = fmt(c); });
  if (num(l.agreed_rpm) > 0) out.final = fmt(num(l.agreed_rpm));
  return out;
}

/** Cell writes that put our numbers into the shipper's own workbook (sheet, 0-based row/col). */
export function sheetWrites(tables: SheetTable[], lanes: (LaneLike & { source_table?: string | null; source_row?: number | null })[], bidFsc: number) {
  const writes: { path: string | null; sheet: string; r: number; c: number; v: number }[] = [];
  for (const l of lanes) {
    const t = tables.find((x) => x.key === l.source_table);
    if (!t || l.source_row == null) continue;
    const vals = laneOutValues(l, bidFsc);
    for (const [k, col] of Object.entries(t.out) as [OutField, string][]) {
      const i = t.headers.indexOf(col);
      const v = vals[k];
      if (i < 0 || v == null) continue;
      writes.push({ path: t.path ?? null, sheet: t.sheet, r: l.source_row, c: t.cols[i]!, v });
    }
  }
  return writes;
}

/** Rows for a returned bid sheet when there's no shipper workbook: their columns, with our numbers in their rate columns or added at the end. */
export function bidSheetRows(headers: string[], lanes: OutLane[], bidFsc: number, outMap: Partial<Record<OutField, string>>): { headers: string[]; rows: Record<string, string | number>[] } {
  const cols = headers.length ? [...headers] : ["Origin City", "Origin State", "Dest City", "Dest State", "Equipment", "Miles"];
  const values = lanes.map((l) => laneOutValues(l, bidFsc));
  const target: Partial<Record<OutField, string>> = {};
  (Object.keys(OUT_FIELDS) as OutField[]).forEach((k) => {
    const mapped = outMap[k] && cols.includes(outMap[k]!) ? outMap[k]! : null;
    const needed = mapped || !COUNTER_FIELDS.includes(k) || values.some((v) => v[k] != null);
    if (!needed) return;
    const c = mapped ?? `Clearwater ${OUT_FIELDS[k]}`;
    target[k] = c;
    if (!cols.includes(c)) cols.push(c);
  });
  const rows = lanes.map((l, i) => {
    const base: Record<string, string | number> = {};
    const orig = (l.original && typeof l.original === "object" ? l.original : null) as Record<string, unknown> | null;
    if (orig) cols.forEach((c) => { const v = orig[c]; if (v != null) base[c] = v as string | number; });
    else Object.assign(base, { "Origin City": l.origin_city, "Origin State": l.origin_state, "Dest City": l.dest_city, "Dest State": l.dest_state, Equipment: l.equipment, Miles: l.miles ?? "" });
    for (const [k, v] of Object.entries(values[i]!) as [OutField, number][]) if (target[k]) base[target[k]!] = v;
    return base;
  });
  return { headers: cols, rows };
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington DC", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** Address text for a miles lookup. A state-only stop ("AL") becomes "Alabama, USA" so it routes to the state's middle. */
export const placeText = (city: string | null, state: string | null, zip: string | null) => {
  if (zip) return `${zip}`;
  const st = (state ?? "").trim().toUpperCase();
  if (!city?.trim() && STATE_NAMES[st]) return `${STATE_NAMES[st]}, USA`;
  return [city, state].filter(Boolean).join(", ");
};
