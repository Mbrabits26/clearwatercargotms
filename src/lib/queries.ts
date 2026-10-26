import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Company } from "@/lib/tms";

// The database caps a single request at 1000 rows; page until exhausted.
export async function fetchAllPaged(
  table: string,
  order: string,
  ascending: boolean,
): Promise<Record<string, any>[]> {
  const PAGE = 1000;
  // Count first, then fetch all pages in parallel (much faster than sequential).
  const { count, error: cErr } = await supabase
    .from(table as "companies")
    .select("id", { count: "exact", head: true });
  if (cErr) throw cErr;
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE) + 1);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      supabase
        .from(table as "companies")
        .select("*")
        .order(order, { ascending })
        .order("id", { ascending: true })
        .range(i * PAGE, i * PAGE + PAGE - 1),
    ),
  );
  const out: Record<string, any>[] = [];
  for (const r of results) {
    if (r.error) throw r.error;
    out.push(...((r.data ?? []) as Record<string, any>[]));
  }
  return out;
}

export const loadsQuery = queryOptions({
  queryKey: ["loads"],
  queryFn: async () =>
    (await fetchAllPaged("loads", "pickup_at", false)) as unknown as import("@/integrations/supabase/types").Tables<"loads">[],
});
// Dispatch board default: only the last 30 days (older loads stay in reports/accounting).
export const recentLoadsQuery = queryOptions({
  queryKey: ["loads", "recent"],
  queryFn: async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("loads")
      .select("*")
      // Undated loads only while still open (skips old imported history).
      .or(
        `pickup_at.gte.${cutoff},and(pickup_at.is.null,closed_at.is.null,status.in.(available,vetting,booked,dispatched,rolling,issue))`,
      )
      .order("pickup_at", { ascending: false });
    if (error) throw error;
    return data;
  },
});
export const carriersQuery = queryOptions({
  queryKey: ["carriers"],
  queryFn: async () => {
    const { data, error } = await supabase.from("carriers").select("*").order("legal_name");
    if (error) throw error;
    return data;
  },
});
export const companiesQuery = queryOptions({
  queryKey: ["companies"],
  queryFn: async () => (await fetchAllPaged("companies", "name", true)) as unknown as Company[],
});
export const profilesQuery = queryOptions({
  queryKey: ["profiles"],
  queryFn: async () => {
    const { data, error } = await supabase.from("profiles").select("*").order("full_name");
    if (error) throw error;
    return data;
  },
});
export const fleetQuery = queryOptions({
  queryKey: ["fleet"],
  queryFn: async () => {
    const { data, error } = await supabase.from("fleet_units").select("*").order("unit_number");
    if (error) throw error;
    return data;
  },
});
export const driversQuery = queryOptions({
  queryKey: ["drivers"],
  queryFn: async () => {
    const { data, error } = await supabase.from("drivers").select("*").order("full_name");
    if (error) throw error;
    return data;
  },
});
// Company-wide lane history (all brokers' loads, no broker attribution) for rate view + lanes run.
export const laneHistoryQuery = (carrierId?: string) => queryOptions({
  queryKey: ["lane-history", carrierId ?? "all"],
  staleTime: 5 * 60_000,
  queryFn: async () => {
    const out: Record<string, any>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.rpc("lane_history_loads", carrierId ? { _carrier: carrierId } : {}).range(from, from + 999);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return out as unknown as import("@/lib/tms").Load[];
  },
});
