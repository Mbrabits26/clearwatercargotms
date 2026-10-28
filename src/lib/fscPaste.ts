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
