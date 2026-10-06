import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  queryFn: async () => {
    const { data, error } = await supabase.from("companies").select("*").order("name");
    if (error) throw error;
    return data;
  },
});
export const profilesQuery = queryOptions({
  queryKey: ["profiles"],
  queryFn: async () => {
    const { data, error } = await supabase.from("profiles").select("*").order("full_name");
    if (error) throw error;
    return data;
  },
});
