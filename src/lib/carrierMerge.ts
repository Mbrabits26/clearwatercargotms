import type { Carrier } from "@/lib/tms";

const SUFFIX = /\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|lp|llp|pllc|trucking|transport|transportation|logistics|express|freight)\b/g;
export const normalizeName = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");

type Matchable = Pick<Carrier, "legal_name" | "mc_number" | "dot_number">;

/** Finds an existing carrier with the same DOT, MC or normalized legal name. */
export function findMatch<T extends Matchable & { id: string }>(list: T[], row: Partial<Matchable>): T | undefined {
  const dot = digits(row.dot_number), mc = digits(row.mc_number), nm = normalizeName(row.legal_name);
  return (dot ? list.find((c) => digits(c.dot_number) === dot) : undefined)
    ?? (mc ? list.find((c) => digits(c.mc_number) === mc) : undefined)
    ?? (nm ? list.find((c) => normalizeName(c.legal_name) === nm) : undefined);
}

const blank = (v: unknown) => v == null || v === "" || v === false;

/** Patch that fills only blank fields on `existing` from `incoming`. */
export function mergeFill(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (["id", "created_at", "status", "dnu_reason"].includes(k)) continue;
    if (!blank(v) && blank(existing[k])) patch[k] = v;
  }
  return patch;
}

/** Groups carriers that look like the same company. */
export function duplicateGroups(list: Carrier[]): Carrier[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; return p === x ? x : find(p); };
  const keys = new Map<string, string>();
  for (const c of list) {
    parent.set(c.id, c.id);
    for (const k of [digits(c.dot_number) && "d" + digits(c.dot_number), digits(c.mc_number) && "m" + digits(c.mc_number), normalizeName(c.legal_name) && "n" + normalizeName(c.legal_name)]) {
      if (!k) continue;
      const o = keys.get(k);
      if (o) parent.set(find(c.id), find(o)); else keys.set(k, c.id);
    }
  }
  const groups = new Map<string, Carrier[]>();
  for (const c of list) { const r = find(c.id); groups.set(r, [...(groups.get(r) ?? []), c]); }
  return [...groups.values()].filter((g) => g.length > 1);
}
