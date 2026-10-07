import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { FmcsaResult } from "./fmcsa.server";

export type FmcsaCarrier = FmcsaResult;

export const lookupFmcsa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ mc: z.string().max(20).nullable(), dot: z.string().max(20).nullable() }).parse(d))
  .handler(async ({ data, context }): Promise<FmcsaCarrier> => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const mc = data.mc?.replace(/\D/g, "") || null;
    const dot = data.dot?.replace(/\D/g, "") || null;
    if (!mc && !dot) throw new Error("Enter an MC # or DOT #.");
    const { lookupCarrierFull } = await import("./fmcsa.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ck = `fmcsa2:${dot ? "dot" + dot : "mc" + mc}`;
    const { data: hit } = await supabaseAdmin.from("market_rate_cache").select("result, fetched_at").eq("key", ck).maybeSingle();
    if (hit && Date.now() - new Date(hit.fetched_at).getTime() < 86400000) return hit.result as unknown as FmcsaCarrier;
    const out = await lookupCarrierFull(mc, dot, process.env["FMCSA_WEBKEY"]);
    await supabaseAdmin.from("market_rate_cache").upsert({ key: ck, result: out as never, fetched_at: new Date().toISOString() });
    return out;
  });
