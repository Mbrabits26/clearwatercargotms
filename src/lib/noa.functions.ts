import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Reads an uploaded NOA or voided check, fills blank factoring fields on the carrier and (finance only) blank payment-account fields. */
export const readNoaDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ carrierId: z.string().uuid(), docId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const { data: fin } = await context.supabase.rpc("is_finance", { _uid: context.userId });
    const { readPayDoc } = await import("./payDoc.server");
    return readPayDoc(context.supabase, !!fin, data);
  });

/** Re-reads every NOA already on file (finance only); fills blanks only, never overwrites. */
export const readAllNoas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offset: z.number().int().min(0).default(0) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: fin } = await sb.rpc("is_finance", { _uid: context.userId });
    if (!fin) throw new Error("Only admins/accountants can read bank details");
    const { data: docs } = await sb.from("carrier_documents").select("id, carrier_id, file_name").in("kind", ["noa", "voided_check"]).not("file_path", "is", null).order("uploaded_at", { ascending: false });
    const all = docs ?? [];
    const batch = all.slice(data.offset, data.offset + 4);
    const { readPayDoc } = await import("./payDoc.server");
    const results = await Promise.all(batch.map(async (d) => {
      try { const r = await readPayDoc(sb, true, { carrierId: d.carrier_id, docId: d.id }); return { carrierId: d.carrier_id, file: d.file_name, filled: r.filled, found: r.found, error: r.bankSkipped || null }; }
      catch (e) { return { carrierId: d.carrier_id, file: d.file_name, filled: [] as string[], found: false, error: e instanceof Error ? e.message : "Failed" }; }
    }));
    return { total: all.length, next: data.offset + batch.length, results };
  });

