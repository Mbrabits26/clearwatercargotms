// Bid Desk math + spreadsheet helpers (pure, browser-safe).
import { buyBox, sellForMargin, type Health } from "@/lib/buyBox";

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
};

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

export const accList = (a: unknown): BidAcc[] =>
  Array.isArray(a) ? a.filter((x) => x && typeof x === "object").map((x: any) => ({ type: String(x.type ?? ""), amount: num(x.amount) })) : [];

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

export const BID_FIELDS = {
  origin: "Origin (City, ST)", origin_city: "Origin city", origin_state: "Origin state", origin_zip: "Origin zip",
  dest: "Destination (City, ST)", dest_city: "Destination city", dest_state: "Destination state", dest_zip: "Destination zip",
  equipment: "Equipment", miles: "Miles", volume: "Volume", pickup_date: "Pickup date",
} as const;
export type BidField = keyof typeof BID_FIELDS;
export const OUT_FIELDS = { linehaul: "Linehaul $", fsc_rpm: "FSC $/mi", fsc: "FSC $", acc: "Accessorials $", all_in: "All-in $", rpm: "All-in $/mi" } as const;
export type OutField = keyof typeof OUT_FIELDS;

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<BidField | OutField, string[]> = {
  origin: ["origin", "from", "shipfrom", "originlocation", "pickup", "pickuplocation", "lanefrom"],
  origin_city: ["origincity", "fromcity", "shipcity", "shippercity", "pickupcity", "ocity"],
  origin_state: ["originstate", "originst", "fromstate", "fromst", "shipstate", "shipperstate", "pickupstate", "ost", "ostate"],
  origin_zip: ["originzip", "originpostal", "originpostalcode", "fromzip", "shipzip", "pickupzip", "ozip"],
  dest: ["destination", "dest", "to", "shipto", "destinationlocation", "delivery", "deliverylocation", "laneto"],
  dest_city: ["destcity", "destinationcity", "tocity", "consigneecity", "deliverycity", "dcity"],
  dest_state: ["deststate", "destinationstate", "destst", "tostate", "tost", "consigneestate", "deliverystate", "dst", "dstate"],
  dest_zip: ["destzip", "destinationzip", "destinationpostal", "destinationpostalcode", "tozip", "consigneezip", "deliveryzip", "dzip"],
  equipment: ["equipment", "equip", "equipmenttype", "mode", "trailer", "trailertype", "service"],
  miles: ["miles", "distance", "mileage", "loadedmiles", "totalmiles"],
  volume: ["volume", "annualvolume", "loads", "loadsperyear", "annualloads", "frequency", "loadsperweek", "weeklyvolume", "monthlyvolume", "estvolume"],
  pickup_date: ["pickupdate", "shipdate", "pudate", "date", "readydate"],
  linehaul: ["linehaul", "linehaulrate", "flatrate", "baserate", "rate", "bidrate", "yourrate"],
  fsc_rpm: ["fsc", "fscpermile", "fuelpermile", "fuelsurcharge", "fuelsurchargepermile", "fscrpm"],
  fsc: ["fscamount", "fueltotal", "fscflat", "totalfuel"],
  acc: ["accessorials", "accessorial", "othercharges", "extras"],
  all_in: ["allin", "allinrate", "total", "totalrate", "totalcost", "allinrateusd"],
  rpm: ["rpm", "ratepermile", "permile", "allinrpm", "costpermile"],
};

/** Best guess of which sheet column feeds each field (exact heading match first, then "contains"). */
export function guessMapping(headers: string[]): Partial<Record<BidField | OutField, string>> {
  const out: Partial<Record<BidField | OutField, string>> = {};
  const used = new Set<string>();
  const keys = Object.keys(ALIASES) as (BidField | OutField)[];
  for (const pass of ["exact", "contains"] as const) {
    for (const k of keys) {
      if (out[k]) continue;
      const hit = headers.find((h) => {
        if (used.has(h)) return false;
        const n = norm(h);
        return pass === "exact" ? ALIASES[k].includes(n) : ALIASES[k].some((a) => a.length >= 4 && n.includes(a));
      });
      if (hit) { out[k] = hit; used.add(hit); }
    }
  }
  // Separate city/state columns beat a combined one.
  if (out.origin && out.origin_city && out.origin_state) delete out.origin;
  if (out.dest && out.dest_city && out.dest_state) delete out.dest;
  return out;
}

/** Finds the heading row (the first of the top 15 rows with at least two recognizable lane headings). */
export function findHeaderRow(grid: unknown[][]): number {
  for (let i = 0; i < Math.min(15, grid.length); i++) {
    const cells = (grid[i] ?? []).map((c) => String(c ?? "")).filter(Boolean);
    const m = guessMapping(cells);
    const lane = ["origin", "origin_city", "origin_state", "origin_zip", "dest", "dest_city", "dest_state", "dest_zip"].filter((k) => m[k as BidField]).length;
    if (lane >= 2) return i;
  }
  return 0;
}

const EQ: [RegExp, string][] = [[/reef|temp|refrig/i, "Reefer"], [/flat/i, "Flatbed"], [/step/i, "Step Deck"], [/power/i, "Power Only"], [/conest/i, "Conestoga"], [/hot ?shot/i, "Hotshot"], [/box/i, "Box Truck"], [/van|dry|53|ftl|tl/i, "Dry Van"]];
export const normEquipment = (v: unknown) => { const s = String(v ?? ""); return EQ.find(([r]) => r.test(s))?.[1] ?? (s.trim() || "Dry Van"); };

export type ParsedLane = {
  origin_city: string; origin_state: string; origin_zip: string | null;
  dest_city: string; dest_state: string; dest_zip: string | null;
  equipment: string; miles: number | null; volume: string | null; loads_per_week: number | null;
  pickup_date: string | null; original: Record<string, unknown>;
};

const toDate = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400_000)).toISOString().slice(0, 10);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** Sheet rows → lanes using a column mapping. Rows without both states are skipped. */
export function rowsToLanes(rows: Record<string, unknown>[], map: Partial<Record<BidField, string>>): ParsedLane[] {
  const g = (r: Record<string, unknown>, k: BidField) => (map[k] ? r[map[k]!] : undefined);
  const s = (v: unknown) => String(v ?? "").trim();
  return rows.map((r) => {
    const o = map.origin ? splitPlace(g(r, "origin")) : { city: "", state: "", zip: "" };
    const d = map.dest ? splitPlace(g(r, "dest")) : { city: "", state: "", zip: "" };
    const vol = g(r, "volume");
    return {
      origin_city: s(g(r, "origin_city")) || o.city,
      origin_state: (s(g(r, "origin_state")) || o.state).toUpperCase().slice(0, 2),
      origin_zip: s(g(r, "origin_zip")) || o.zip || null,
      dest_city: s(g(r, "dest_city")) || d.city,
      dest_state: (s(g(r, "dest_state")) || d.state).toUpperCase().slice(0, 2),
      dest_zip: s(g(r, "dest_zip")) || d.zip || null,
      equipment: normEquipment(g(r, "equipment")),
      miles: Number(String(g(r, "miles") ?? "").replace(/[^0-9.]/g, "")) || null,
      volume: s(vol) || null,
      loads_per_week: vol == null || vol === "" ? null : volumeToWeekly(vol, map.volume ?? ""),
      pickup_date: toDate(g(r, "pickup_date")),
      original: r,
    };
  }).filter((l) => /^[A-Z]{2}$/.test(l.origin_state) && /^[A-Z]{2}$/.test(l.dest_state));
}

/** Rows for the returned bid sheet: the shipper's own columns, with our numbers in their rate columns or added at the end. */
export function bidSheetRows(
  headers: string[],
  lanes: (LaneLike & { original?: unknown; origin_city: string; origin_state: string; dest_city: string; dest_state: string; equipment: string })[],
  bidFsc: number,
  outMap: Partial<Record<OutField, string>>,
): { headers: string[]; rows: Record<string, string | number>[] } {
  const cols = headers.length ? [...headers] : ["Origin City", "Origin State", "Dest City", "Dest State", "Equipment", "Miles"];
  const target: Record<OutField, string> = {} as never;
  (Object.keys(OUT_FIELDS) as OutField[]).forEach((k) => {
    const c = outMap[k] && cols.includes(outMap[k]!) ? outMap[k]! : `Clearwater ${OUT_FIELDS[k]}`;
    target[k] = c;
    if (!cols.includes(c)) cols.push(c);
  });
  const rows = lanes.map((l) => {
    const base: Record<string, string | number> = {};
    const orig = (l.original && typeof l.original === "object" ? l.original : null) as Record<string, unknown> | null;
    if (orig) cols.forEach((c) => { const v = orig[c]; if (v != null) base[c] = v as string | number; });
    else Object.assign(base, { "Origin City": l.origin_city, "Origin State": l.origin_state, "Dest City": l.dest_city, "Dest State": l.dest_state, Equipment: l.equipment, Miles: l.miles ?? "" });
    const t = laneTotals(l, bidFsc);
    if (t.linehaul > 0) {
      base[target.linehaul] = t.linehaul;
      base[target.fsc_rpm] = round2(t.fscRpm);
      base[target.fsc] = t.fsc;
      base[target.acc] = round2(t.acc);
      base[target.all_in] = t.allIn;
      base[target.rpm] = t.allInRpm == null ? "" : round2(t.allInRpm);
    }
    return base;
  });
  return { headers: cols, rows };
}
