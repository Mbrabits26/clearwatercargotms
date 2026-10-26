import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WorkLoad } from "@/lib/loadWork";

export const loadWorkQuery = queryOptions({
  queryKey: ["load-work"], staleTime: 60_000,
  queryFn: async () => {
    const loads: WorkLoad[] = [];
    const invoiceIds = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("loads")
        .select("id,load_number,status,broker_id,delivery_at,source,pod_received,closed_at,customer_id,customer_ref,origin_city,dest_city")
        .neq("status", "cancelled").order("id").range(from, from + 999);
      if (error) throw error;
      loads.push(...data);
      if (data.length < 1000) break;
    }
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("qb_sync").select("id,load_id")
        .in("kind", ["invoice", "fleet_invoice"]).order("id").range(from, from + 999);
      if (error) throw error;
      data.forEach((row) => invoiceIds.add(row.load_id));
      if (data.length < 1000) break;
    }
    return { loads, invoiceIds };
  },
});