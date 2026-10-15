import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Reads an uploaded COI and fills the carrier's insurance limits and dates. */
export const readCoiDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ carrierId: z.string().uuid(), docId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const { data: doc } = await context.supabase.from("carrier_documents").select("*").eq("id", data.docId).eq("carrier_id", data.carrierId).single();
    if (!doc?.file_path) throw new Error("Document not found");
    const { data: blob } = await context.supabase.storage.from("carrier-docs").download(doc.file_path);
    if (!blob || blob.size > 9_000_000) throw new Error("File too large to read");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI not configured");
    const { readCoi, coiPatch } = await import("./coi.server");
    const p = await readCoi(Buffer.from(await blob.arrayBuffer()).toString("base64"), doc.file_name ?? doc.file_path, blob.type, key);
    if (!p) return { found: false, coi: null };
    const patch = coiPatch(p);
    const { error } = await context.supabase.from("carriers").update(patch as never).eq("id", data.carrierId);
    if (error) throw new Error(error.message);
    if (p.auto_expires) await context.supabase.from("carrier_documents").delete().eq("id", "00000000-0000-0000-0000-000000000000"); // no-op guard
    return { found: Object.keys(patch).length > 1, coi: p };
  });
