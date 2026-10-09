import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// The database caps a single request at 1000 rows; page until exhausted.
async function fetchAllPaged(
  table: string,
  order: string,
  ascending: boolean,
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(order, { ascending })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export const loadsQuery = queryOptions({
  queryKey: ["loads"],
  queryFn: async () => {
    const { data, error } = await supabase.from("loads").select("*").order("pickup_at", { ascending: false });
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
  queryFn: async () => fetchAllPaged("companies", "name", true),
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
