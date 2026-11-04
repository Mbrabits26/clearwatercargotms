import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isPodDoc, parseAttachments } from "@/lib/qbAttachments";

const PATH = /^[0-9a-f-]{36}\/[^/]+$/i;

/**
 * Deletes one file from a load's documents. Staff only; the caller must be able to see the load.
 * Signed rate cons and carrier invoices on a bill are refused (void them instead). The delete is
 * recorded in the deletion log, the file is dropped from any not-yet-sent QuickBooks picks, and the
 * load's "Signed POD received" flag is cleared when no POD remains.
 */
export const deleteLoadDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ path: z.string().trim().regex(PATH).max(400) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: staff } = await sb.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Only staff can delete load documents.");
    const loadId = data.path.split("/")[0]!;
    const file = data.path.split("/")[1]!;
    const { data: load } = await sb.from("loads").select("id, load_number, ratecon_pdf_path, pod_received").eq("id", loadId).maybeSingle();
    if (!load) throw new Error("Load not found or not visible to you.");

    if (load.ratecon_pdf_path === data.path) throw new Error("This is the signed rate con. Signed rate cons are voided, never deleted.");
    const { data: rc } = await sb.from("ratecon_requests").select("id").eq("pdf_path", data.path).limit(1);
    if (rc?.length) throw new Error("This is a signed rate con. Signed rate cons are voided, never deleted.");
    const { data: rows } = await sb.from("qb_sync").select("id, carrier_invoice_path, attachments, attachments_sent").eq("load_id", loadId);
    if ((rows ?? []).some((r) => r.carrier_invoice_path === data.path)) throw new Error("This is the carrier invoice on a bill in Accounting. Replace it there instead.");

    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: listed } = await admin.storage.from("load-docs").list(loadId, { limit: 500 });
    const obj = (listed ?? []).find((f) => f.name === file && f.id);
    if (!obj) throw new Error("File not found — it may already be deleted.");
    const { data: names } = await admin.from("load_doc_names").select("path, display_name").like("path", `${loadId}/%`);
    const nameOf = (p: string) => names?.find((n) => n.path === p)?.display_name ?? null;
    const shown = nameOf(data.path) ?? file;

    const { error: delErr } = await admin.storage.from("load-docs").remove([data.path]);
    if (delErr) throw new Error(delErr.message);
    await admin.from("deletion_log").insert({
      table_name: "load_documents", row_id: obj.id, label: `${load.load_number} · ${shown}`, deleted_by: context.userId,
      snapshot: { bucket: "load-docs", path: data.path, name: shown, load_id: loadId, load_number: load.load_number, size: obj.metadata?.size ?? null },
    });
    await admin.from("load_doc_names").delete().eq("path", data.path);

    let inQuickBooks = false;
    for (const r of rows ?? []) {
      const sent = Array.isArray(r.attachments_sent) ? r.attachments_sent.map((s) => (typeof s === "string" ? s : String((s as { path?: string })?.path ?? ""))) : [];
      if (sent.includes(data.path)) inQuickBooks = true;
      const picks = parseAttachments(r.attachments);
      if (picks.some((a) => a.path === data.path)) {
        await admin.from("qb_sync").update({ attachments: picks.filter((a) => a.path !== data.path) } as never).eq("id", r.id);
      }
    }

    let podCleared = false;
    if (load.pod_received && isPodDoc(file, shown)) {
      const others = (listed ?? []).filter((f) => f.id && f.name !== file);
      if (!others.some((f) => isPodDoc(f.name, nameOf(`${loadId}/${f.name}`)))) {
        const { error } = await sb.from("loads").update({ pod_received: false }).eq("id", loadId);
        podCleared = !error;
      }
    }
    return { deleted: shown, inQuickBooks, podCleared };
  });
