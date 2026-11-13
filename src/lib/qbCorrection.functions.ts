import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { correctionPlan, type CorrectionRow } from "./qbCorrection";
import type { QbInvoice } from "./qbMatch";

const input = z.object({ rowId: z.string().uuid(), previousRef: z.string().nullable(), qbId: z.string().optional(), choice: z.enum(["blank", "new", "previous", "existing"]).default("blank"), replacementId: z.string().optional(), otherRowIds: z.array(z.string().uuid()).default([]), newKind: z.enum(["invoice", "fleet_invoice"]).optional() });

export const qbCorrectionPreview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rowId: z.string().uuid(), qbId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: finance } = await context.supabase.rpc("is_finance", { _uid: context.userId });
    if (!finance) throw new Error("Admins or accountants only.");
    const { data: row, error } = await context.supabase.from("qb_sync").select("kind").eq("id", data.rowId).single();
    if (error || !row || row.kind === "bill") throw new Error("Customer invoice not found.");
    const { data: other, error: otherError } = await context.supabase.from("qb_sync").select("id, invoice_number, load_id, amount, deductions, loads(load_number, customer_ref)").eq("kind", row.kind).eq("qb_ref", data.qbId);
    if (otherError) throw new Error(otherError.message);
    return { other: (other ?? []).filter((r) => r.id !== data.rowId) };
  });

export const qbCorrectInvoices = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data, context }) => {
    const { data: finance } = await context.supabase.rpc("is_finance", { _uid: context.userId });
    if (!finance) throw new Error("Admins or accountants only.");
    const { data: row, error } = await context.supabase.from("qb_sync").select("id, kind, invoice_number, qb_ref, attachments").eq("id", data.rowId).single();
    if (error || !row || row.kind === "bill") throw new Error("Customer invoice not found.");
    if (row.qb_ref !== data.previousRef) throw new Error("Invoice changed. Refresh and verify again.");
    const group = async (r: CorrectionRow) => {
      let q = context.supabase.from("qb_sync").select("id, kind, invoice_number, qb_ref, attachments").eq("kind", r.kind);
      q = r.invoice_number ? q.eq("invoice_number", r.invoice_number) : q.eq("id", r.id);
      q = r.qb_ref ? q.eq("qb_ref", r.qb_ref) : q.is("qb_ref", null);
      const { data: rows, error: e } = await q;
      if (e || !rows?.length) throw new Error("Invoice group could not be read.");
      return rows;
    };
    const rows = await group(row);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { lookupExistingInvoice, entityForKind, listInvoiceFiles } = await import("./quickbooks.server");
    const { parseAttachments } = await import("./qbAttachments");
    const entity = entityForKind(row.kind);
    const verify = async (id: string) => {
      const [invoice] = await lookupExistingInvoice(supabaseAdmin, entity, id, "id");
      if (!invoice?.docNumber) throw new Error("QuickBooks invoice could not be verified.");
      return invoice;
    };
    const sent = async (rs: CorrectionRow[], invoice: QbInvoice | null) => {
      if (!invoice) return [];
      const names = new Set((await listInvoiceFiles(supabaseAdmin, entity, [invoice.id])).map((f) => f.name));
      return rs.flatMap((r) => parseAttachments(r.attachments).filter((a) => names.has(a.name)).map((a) => a.path));
    };
    if (!data.qbId) {
      if (data.choice !== "new" && data.choice !== "blank") throw new Error("Choose an invoice first.");
      const plan = correctionPlan(rows, "current", null, data.choice, data.newKind ?? row.kind);
      const { data: result, error: e } = await context.supabase.rpc("apply_invoice_correction", { p_plan: plan });
      if (e) throw new Error(e.message);
      return { rows: result };
    }
    const invoice = await verify(data.qbId);
    const { data: used, error: usedError } = await context.supabase.from("qb_sync").select("id, kind, invoice_number, qb_ref, attachments").eq("kind", row.kind).eq("qb_ref", invoice.id);
    if (usedError) throw new Error(usedError.message);
    const others = (used ?? []).filter((r) => !rows.some((s) => s.id === r.id));
    if (others.length !== data.otherRowIds.length || others.some((r) => !data.otherRowIds.includes(r.id))) throw new Error("Other invoice links changed. Check both loads again.");
    let replacement: QbInvoice | null = null;
    if (others.length && data.choice === "previous") {
      if (!row.qb_ref || row.qb_ref === invoice.id) throw new Error("No previous invoice available to swap.");
      replacement = await verify(row.qb_ref);
    }
    if (others.length && data.choice === "existing") {
      if (!data.replacementId) throw new Error("Find and verify the other load's replacement invoice.");
      replacement = await verify(data.replacementId);
      if (replacement.id === invoice.id) throw new Error("Both groups cannot share this invoice.");
    }
    const plan = correctionPlan(rows, "current", invoice, "existing", row.kind, await sent(rows, invoice));
    if (others.length) plan.push(...correctionPlan(others, "other", replacement, data.choice, data.newKind ?? row.kind, await sent(others, replacement)));
    const { data: result, error: e } = await context.supabase.rpc("apply_invoice_correction", { p_plan: plan });
    if (e) throw new Error(e.message);
    return { rows: result };
  });