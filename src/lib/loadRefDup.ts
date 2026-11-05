import { supabase } from "@/integrations/supabase/client";

const COLS = ["customer_ref", "ship_ref", "dest_ref"] as const;
const LABEL: Record<(typeof COLS)[number], string> = { customer_ref: "Customer ref #", ship_ref: "Shipper PO / PU ref", dest_ref: "Delivery ref / appt #" };
export const normRef = (v: string | null | undefined) => (v ?? "").trim().toLowerCase().replace(/\s+/g, "");

type Hit = { id: string; load_number: string; status: string } & Record<(typeof COLS)[number], string | null>;
/** Pure: which of our refs appear (any ref column, case/space-insensitive) on other loads. */
export function refMatches(mine: Partial<Record<(typeof COLS)[number], string | null>>, others: Hit[], selfId?: string) {
  const out: string[] = [];
  for (const k of COLS) {
    const v = normRef(mine[k]);
    if (v.length < 3) continue;
    for (const o of others) {
      if (o.id === selfId || o.status === "cancelled") continue;
      const col = COLS.find((c) => normRef(o[c]) === v);
      if (col) out.push(`${LABEL[k]} "${mine[k]!.trim()}" is already on ${o.load_number} (${LABEL[col]}, ${o.status})`);
    }
  }
  return out;
}

/** Looks up other loads sharing any reference number; returns plain-English warnings. */
export async function findRefDuplicates(mine: Partial<Record<(typeof COLS)[number], string | null>>, selfId?: string) {
  const vals = [...new Set(COLS.map((k) => mine[k]?.trim()).filter((v): v is string => !!v && v.length >= 3))];
  if (!vals.length) return [];
  const esc = (v: string) => v.replace(/[\\%_]/g, (m) => `\\${m}`);
  const results = await Promise.all(vals.flatMap((v) => COLS.map((c) =>
    supabase.from("loads").select("id,load_number,status,customer_ref,ship_ref,dest_ref").ilike(c, esc(v)).limit(10))));
  const seen = new Map<string, Hit>();
  for (const r of results) for (const row of (r.data ?? []) as Hit[]) seen.set(row.id, row);
  return refMatches(mine, [...seen.values()], selfId);
}
