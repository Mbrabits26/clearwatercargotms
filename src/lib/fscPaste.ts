// Fuel surcharge paste helpers for the Bid Desk (pure, browser-safe). Bid Desk FSC is always $/mi.

export type FscRow = { min: number; max: number | null; rpm: number };
export type FscPaste =
  | { kind: "empty" }
  | { kind: "single"; rpm: number }
  | { kind: "list"; rates: number[] }
  | { kind: "schedule"; rows: FscRow[] }
  | { kind: "error"; message: string };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
// Unsigned numbers only, so "3.50-3.59" reads as two prices, not 3.50 and −3.59.
const numbersIn = (line: string) => (line.replace(/[$,]/g, "").match(/\d+(?:\.\d+)?|\.\d+/g) ?? []).map(Number);

/**
 * Reads what was copied from a fuel table, email or spreadsheet:
 * - one number → one $/mi for every lane
 * - one number per line → one $/mi per lane, in lane order
 * - lines with a diesel price (range) and a $/mi → a fuel surcharge table
 */
export function parseFscPaste(text: string): FscPaste {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { kind: "empty" };
  if (lines.some((l) => /%/.test(l))) return { kind: "error", message: "That looks like a percent-of-linehaul table. The Bid Desk prices fuel per mile — paste $/mi rates, or use “Figure from diesel price”." };
  const rows = lines.map(numbersIn).filter((n) => n.length > 0);
  if (!rows.length) return { kind: "error", message: "No numbers found in what you pasted." };
  const multi = rows.filter((n) => n.length >= 2);
  if (multi.length >= Math.max(2, Math.ceil(rows.length / 2))) {
    const parsed = multi.map((n) => (n.length >= 3 ? { min: n[0]!, max: n[1]!, rpm: n[n.length - 1]! } : { min: n[0]!, max: null as number | null, rpm: n[1]! }))
      .filter((r) => r.rpm < r.min) // diesel $/gal is always more than the $/mi surcharge
      .sort((a, b) => a.min - b.min);
    if (parsed.length < 2) return { kind: "error", message: "Couldn't read a fuel table. Each line should have a diesel price (or range) and the $/mi, e.g. “3.50 – 3.59  0.45”." };
    // Two-column tables: each row runs up to the next row's price.
    const filled = parsed.map((r, i) => (r.max != null ? r : { ...r, max: parsed[i + 1] ? round3(parsed[i + 1]!.min - 0.001) : null }));
    return { kind: "schedule", rows: filled };
  }
  const rates = rows.map((n) => n[n.length - 1]!);
  if (rates.some((r) => r > 5)) return { kind: "error", message: "Some numbers are over $5/mi — that looks like diesel prices, not surcharges. Paste the full fuel table (price and $/mi on each line)." };
  return rates.length === 1 ? { kind: "single", rpm: rates[0]! } : { kind: "list", rates };
}

/** $/mi from a fuel table for the current diesel price. Below the first row there's no surcharge; above the last row the top rate holds. */
export function fscForPrice(rows: FscRow[], price: number): { rpm: number; row: FscRow | null; note: string } {
  const sorted = [...rows].sort((a, b) => a.min - b.min);
  if (!sorted.length || !(price > 0)) return { rpm: 0, row: null, note: "Type the current diesel price." };
  if (price < sorted[0]!.min) return { rpm: 0, row: null, note: `Diesel is under the table's lowest price ($${sorted[0]!.min.toFixed(2)}), so no surcharge.` };
  const hit = sorted.find((r) => price >= r.min && (r.max == null || price <= r.max + 0.0005));
  if (hit) return { rpm: hit.rpm, row: hit, note: `$${price.toFixed(3)} falls in $${hit.min.toFixed(2)}${hit.max != null ? `–$${hit.max.toFixed(3)}` : "+"}.` };
  const top = sorted[sorted.length - 1]!;
  if (price > (top.max ?? top.min)) return { rpm: top.rpm, row: top, note: `Diesel is above the table's top price, so its top rate is used.` };
  // Price sits in a gap between rows: use the row below it.
  const below = [...sorted].reverse().find((r) => r.min <= price)!;
  return { rpm: below.rpm, row: below, note: `$${price.toFixed(3)} sits between rows; using the $${below.min.toFixed(2)} row.` };
}

/** Standard per-mile formula: (current diesel − base price) ÷ truck MPG, never below zero. */
export const fscFormula = (price: number, base: number, mpg: number) => (price > 0 && mpg > 0 ? Math.max(0, round3((price - base) / mpg)) : 0);

/** Linehaul after a fuel change when the all-in should stay the same (linehaul absorbs it). */
export const linehaulKeepingAllIn = (linehaul: number, miles: number, oldRpm: number, newRpm: number) =>
  linehaul > 0 ? Math.max(0, Math.round(linehaul - (newRpm - oldRpm) * miles)) : linehaul;

// ---------- Weekly fuel posts (diesel $/gal or FSC $/mi, split by region or another option) ----------

export type RegionKey = "us" | "east" | "ne" | "catl" | "latl" | "mw" | "gulf" | "rocky" | "west" | "wxca" | "ca";
export const REGION_NAMES: Record<RegionKey, string> = {
  us: "U.S. average", east: "East Coast", ne: "New England", catl: "Central Atlantic", latl: "Lower Atlantic",
  mw: "Midwest", gulf: "Gulf Coast", rocky: "Rocky Mountain", west: "West Coast", wxca: "West Coast less California", ca: "California",
};
// DOE/EIA (PADD) regions by state.
const STATE_REGION: Record<string, RegionKey> = {};
const put = (k: RegionKey, s: string) => s.split(" ").forEach((st) => (STATE_REGION[st] = k));
put("ne", "CT ME MA NH RI VT"); put("catl", "DE DC MD NJ NY PA"); put("latl", "FL GA NC SC VA WV");
put("mw", "IL IN IA KS KY MI MN MO NE ND SD OH OK TN WI"); put("gulf", "AL AR LA MS NM TX");
put("rocky", "CO ID MT UT WY"); put("wxca", "AK AZ HI NV OR WA"); put("ca", "CA");
const PADD: Record<string, RegionKey> = { "1": "east", "1A": "ne", "1B": "catl", "1C": "latl", "2": "mw", "3": "gulf", "4": "rocky", "5": "west" };
const PARENT: Partial<Record<RegionKey, RegionKey>> = { ne: "east", catl: "east", latl: "east", wxca: "west", ca: "west" };

/** Most specific region first, then its parent, then the U.S. average. */
export function regionChain(state: string | null | undefined): RegionKey[] {
  const r = STATE_REGION[(state ?? "").trim().toUpperCase()];
  if (!r) return ["us"];
  const p = PARENT[r];
  return p ? [r, p, "us"] : [r, "us"];
}

/** Which region a posted label means (EIA names, PADD numbers, or common names). */
export function regionOfLabel(label: string): RegionKey | null {
  const s = ` ${label.toLowerCase().replace(/[^a-z0-9.]+/g, " ")} `;
  if (/less california|excl\w* california|ex california/.test(s)) return "wxca";
  if (/california/.test(s)) return "ca";
  if (/new england|padd ?1a|northeast/.test(s)) return "ne";
  if (/central atlantic|mid ?atlantic|padd ?1b/.test(s)) return "catl";
  if (/lower atlantic|southeast|padd ?1c/.test(s)) return "latl";
  if (/east coast|padd ?1 /.test(s)) return "east";
  if (/midwest|mid west|padd ?2/.test(s)) return "mw";
  if (/gulf|padd ?3/.test(s)) return "gulf";
  if (/rocky|mountain|padd ?4/.test(s)) return "rocky";
  if (/west coast|padd ?5/.test(s)) return "west";
  if (/ u\.?s\.? |national|united states|nationwide|us average/.test(s)) return "us";
  return null;
}

const EQUIP_ALIASES: [RegExp, string][] = [
  [/reefer|refrig/i, "Reefer"], [/step ?deck/i, "Step Deck"], [/flat ?bed|flat/i, "Flatbed"], [/conestoga/i, "Conestoga"],
  [/power only/i, "Power Only"], [/hot ?shot/i, "Hotshot"], [/box truck|straight truck/i, "Box Truck"], [/dry van|\bvan\b/i, "Dry Van"],
];
export const equipmentOfLabel = (label: string) => EQUIP_ALIASES.find(([re]) => re.test(label))?.[1] ?? null;

export type FuelEntry = { label: string; value: number; region: RegionKey | null; equipment: string | null };
export type FuelPosting = { kind: "diesel" | "fsc"; entries: FuelEntry[]; weekOf: string | null };

const DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:,? (\d{4}))?/gi;
const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
function datesIn(line: string): Date[] {
  const out: Date[] = [];
  for (const m of line.matchAll(DATE_RE)) {
    const y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : m[6] ? Number(m[6]) : new Date().getFullYear();
    const mo = m[1] ? Number(m[1]) - 1 : MONTHS.indexOf(m[4]!.slice(0, 3).toLowerCase());
    const d = m[2] ? Number(m[2]) : Number(m[5]);
    if (mo >= 0 && mo < 12 && d >= 1 && d <= 31) out.push(new Date(y, mo, d));
  }
  return out;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isDiesel = (n: number) => n >= 1.5 && n <= 9;

/**
 * Reads a weekly fuel post: one line per region or option ("Lower Atlantic (PADD 1C)  3.701  3.689 …",
 * "Reefer 0.58"). Diesel posts ($/gal) use the newest week's column (by the dates in the header when given);
 * $/mi posts use the first number on each line.
 */
export function parseFuelPosting(text: string): FuelPosting | { error: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let headerDates: Date[] = [];
  const rows: { label: string; region: RegionKey | null; nums: number[] }[] = [];
  for (const line of lines) {
    const ds = datesIn(line);
    let padd: RegionKey | null = null;
    const clean = line.replace(DATE_RE, " ")
      .replace(/\(?\bPADD\s*(\d)\s*([A-C]?)\)?/gi, (_m, d: string, l: string) => { padd = PADD[`${d}${l.toUpperCase()}`] ?? padd; return " "; })
      .replace(/[$,]/g, "");
    const firstNum = clean.search(/\d|\.\d/);
    const label = (firstNum < 0 ? clean : clean.slice(0, firstNum)).replace(/[\s:\-–=()]+$/g, "").replace(/\s+/g, " ").trim();
    const nums = firstNum < 0 ? [] : (clean.slice(firstNum).match(/\d+(?:\.\d+)?|\.\d+/g) ?? []).map(Number);
    if (ds.length && !nums.length) { if (ds.length >= headerDates.length) headerDates = ds; continue; }
    if (!nums.length || (!/[a-z]/i.test(label) && !padd)) continue;
    rows.push({ label: label || REGION_NAMES[padd!], region: regionOfLabel(label) ?? padd, nums });
  }
  if (!rows.length) return { error: "Couldn't find any regions or options with a number next to them." };
  const diesel = rows.filter((r) => r.nums.some(isDiesel)).length >= Math.ceil(rows.length / 2);
  const newestFirst = headerDates.length >= 2 && headerDates[0]! > headerDates[headerDates.length - 1]!;
  const entries: FuelEntry[] = [];
  for (const r of rows) {
    const pool = diesel ? r.nums.filter(isDiesel) : r.nums.filter((n) => n < 1.5);
    if (!pool.length) continue;
    const value = diesel ? (newestFirst ? pool[0]! : pool[pool.length - 1]!) : pool[0]!;
    entries.push({ label: r.label, value, region: r.region, equipment: equipmentOfLabel(r.label) });
  }
  if (!entries.length) return { error: "Couldn't read a price on any line." };
  const newest = headerDates.length ? headerDates.reduce((a, b) => (b > a ? b : a)) : null;
  return { kind: diesel ? "diesel" : "fsc", entries, weekOf: newest ? iso(newest) : null };
}

/** The posted entry for one lane: by its pickup (or delivery) region (falling back to the broader region, then U.S.), or by trailer type. */
export function entryForLane(entries: FuelEntry[], lane: { origin_state?: string | null; dest_state?: string | null; equipment?: string | null }, by: "region" | "equipment", side: "pickup" | "delivery" = "pickup"): FuelEntry | null {
  if (by === "equipment") return entries.find((e) => e.equipment && e.equipment === (lane.equipment || "Dry Van")) ?? null;
  const [first, second] = side === "delivery" ? [lane.dest_state, lane.origin_state] : [lane.origin_state, lane.dest_state];
  const state = STATE_REGION[(first ?? "").trim().toUpperCase()] ? first : second;
  for (const k of regionChain(state)) { const e = entries.find((x) => x.region === k); if (e) return e; }
  return null;
}
