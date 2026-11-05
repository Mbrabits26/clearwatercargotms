import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CarrierCheckReport } from "./carrierCheck";

const TTL = 7 * 86400000;

/** Staff-only. Returns the cached Carrier Checks report (≤7 days) or builds a fresh one. */
export const getCarrierCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ mc: z.string().max(20).nullable(), dot: z.string().max(20).nullable(), refresh: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }): Promise<CarrierCheckReport> => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const mc = data.mc?.replace(/\D/g, "") || null;
    const dot = data.dot?.replace(/\D/g, "") || null;
    if (!mc && !dot) throw new Error("Enter an MC # or DOT #.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ck = `carrierchk:${dot ? "dot" + dot : "mc" + mc}`;
    if (!data.refresh) {
      const { data: hit } = await supabaseAdmin.from("market_rate_cache").select("result, fetched_at").eq("key", ck).maybeSingle();
      if (hit && Date.now() - new Date(hit.fetched_at).getTime() < TTL) return hit.result as unknown as CarrierCheckReport;
    }
    const { buildCarrierCheck } = await import("./carrierCheck.server");
    const r = await buildCarrierCheck(mc, dot, process.env["FMCSA_WEBKEY"]);
    const now = new Date().toISOString();
    await supabaseAdmin.from("market_rate_cache").upsert([{ key: ck, result: r as never, fetched_at: now }, ...(dot ? [] : [{ key: `carrierchk:dot${r.dot}`, result: r as never, fetched_at: now }])]);
    return r;
  });
