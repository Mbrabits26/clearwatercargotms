import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Merges duplicate carriers into `keepId`: fills blanks, repoints related rows, deletes the duplicates. */
export const mergeCarriers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ keepId: z.string().uuid(), dropIds: z.array(z.string().uuid()).min(1).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const drop = data.dropIds.filter((x) => x !== data.keepId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.from("carriers").select("*").in("id", [data.keepId, ...drop]);
    if (error) throw new Error(error.message);
    const keep = rows?.find((r) => r.id === data.keepId);
    if (!keep) throw new Error("Carrier not found");
    const others = rows!.filter((r) => r.id !== keep.id);
    const patch: Record<string, unknown> = {};
    for (const o of others) for (const [k, v] of Object.entries(o)) {
      if (["id", "created_at", "status", "dnu_reason"].includes(k)) continue;
      const cur = k in patch ? patch[k] : (keep as Record<string, unknown>)[k];
      if ((cur == null || cur === "" || cur === false) && v != null && v !== "" && v !== false) patch[k] = v;
    }
    const all = [keep, ...others];
    const dnu = all.find((r) => r.status === "dnu");
    if (dnu) { patch.status = "dnu"; patch.dnu_reason = dnu.dnu_reason; }
    else if (all.some((r) => r.status === "vetted")) patch.status = "vetted";
    if (Object.keys(patch).length) {
      const { error: e } = await supabaseAdmin.from("carriers").update(patch as never).eq("id", keep.id);
      if (e) throw new Error(e.message);
    }
    for (const t of ["carrier_documents", "load_offers", "carrier_invites"] as const) {
      const { error: e } = await supabaseAdmin.from(t).update({ carrier_id: keep.id }).in("carrier_id", drop);
      if (e) throw new Error(e.message);
    }
    // Loads: bypass the compliance trigger concern by only repointing — the kept carrier inherits the best status.
    const { error: le } = await supabaseAdmin.from("loads").update({ carrier_id: keep.id }).in("carrier_id", drop);
    if (le) throw new Error(`Couldn't move loads: ${le.message}`);
    const { error: de } = await supabaseAdmin.from("carriers").delete().in("id", drop);
    if (de) throw new Error(de.message);
    return { merged: drop.length };
  });
