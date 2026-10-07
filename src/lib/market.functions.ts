import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MarketRate } from "./market.server";

export type { MarketRate };

export const getMarketRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      origin_state: z.string().length(2),
      dest_state: z.string().length(2),
      equipment: z.string().max(40),
      refresh: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ result: MarketRate | null; fetched_at: string | null; error: string | null }> => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const key = `${data.equipment}|${data.origin_state.toUpperCase()}|${data.dest_state.toUpperCase()}`.toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!data.refresh) {
      const { data: hit } = await supabaseAdmin.from("market_rate_cache").select("*").eq("key", key).maybeSingle();
      if (hit && Date.now() - new Date(hit.fetched_at).getTime() < 24 * 3600_000) {
        return { result: hit.result as unknown as MarketRate, fetched_at: hit.fetched_at, error: null };
      }
    }
    const fc = process.env["FIRECRAWL_API_KEY"];
    const ai = process.env["LOVABLE_API_KEY"];
    if (!fc) return { result: null, fetched_at: null, error: "Market rate search isn't connected yet." };
    if (!ai) return { result: null, fetched_at: null, error: "AI isn't configured." };
    try {
      const { fetchMarketRates } = await import("./market.server");
      const result = await fetchMarketRates(data, fc, ai);
      const fetched_at = new Date().toISOString();
      await supabaseAdmin.from("market_rate_cache").upsert({ key, result: result as never, fetched_at });
      return { result, fetched_at, error: null };
    } catch (e) {
      console.error("market rates", e);
      return { result: null, fetched_at: null, error: (e as Error).message };
    }
  });
