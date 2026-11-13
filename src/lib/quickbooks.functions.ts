import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = { rpc: (f: string, a: object) => Promise<{ data: boolean }> };
/** Connect/disconnect: admins and accountants only. */
async function requireAdmin(ctx: { supabase: unknown; userId: string }) {
  const { data } = await (ctx.supabase as Rpc).rpc("is_finance", { _uid: ctx.userId });
  if (!data) throw new Error("Admins or accountants only.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
/** Status + sending queued invoices/bills: any staff member (brokers included). */
async function requireStaff(ctx: { supabase: unknown; userId: string }) {
  const { data } = await (ctx.supabase as Rpc).rpc("is_staff", { _uid: ctx.userId });
  if (!data) throw new Error("Staff only.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const qbStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await requireStaff(context as never);
    const { data } = await admin.from("qb_connection" as never).select("id, company_name, connected_at").in("id", [1, 2]);
    const rows = (data ?? []) as { id: number; company_name: string | null; connected_at: string }[];
    const one = (id: number) => { const d = rows.find((r) => r.id === id); return { connected: !!d, company: d?.company_name ?? null, connectedAt: d?.connected_at ?? null }; };
    const brokerage = one(1), fleet = one(2);
    return { ...brokerage, brokerage, fleet, keysSaved: !!process.env["QUICKBOOKS_CLIENT_ID"] };
  });

export const qbStartConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ entity: z.enum(["brokerage", "fleet"]).default("brokerage") }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const { authorizeUrl } = await import("./quickbooks.server");
    // The target company rides in the state value so the return page knows which slot to fill.
    const state = `${data.entity}:${crypto.randomUUID()}`;
    await admin.from("qb_oauth_state" as never).insert({ state, user_id: context.userId } as never);
    return { url: authorizeUrl(state) };
  });

export const qbFinishConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ code: z.string().min(1), state: z.string().min(1), realmId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const { data: st } = await admin.from("qb_oauth_state" as never).select("*").eq("state", data.state).maybeSingle();
    const s = st as { user_id: string; created_at: string } | null;
    await admin.from("qb_oauth_state" as never).delete().eq("state", data.state);
    if (!s || s.user_id !== context.userId || Date.now() - new Date(s.created_at).getTime() > 15 * 60_000) throw new Error("This QuickBooks sign-in link expired. Please click Connect again.");
    const { exchangeCode } = await import("./quickbooks.server");
    const entity = data.state.startsWith("fleet:") ? "fleet" : "brokerage";
    const company = await exchangeCode(admin, data.code, data.realmId, context.userId, entity);
    return { company, entity };
  });

export const qbDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ entity: z.enum(["brokerage", "fleet"]).default("brokerage") }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    await admin.from("qb_connection" as never).delete().eq("id", data.entity === "fleet" ? 2 : 1);
    return { ok: true };
  });

export const qbSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).optional(), force: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await requireStaff(context as never);
    if (data.force && !data.ids?.length) throw new Error("Pick the invoice to send anyway.");
    const { deliverQueued, sendAttachments, autoAttachPods } = await import("./quickbooks.server");
    // PODs already on a load ride along with its customer invoice automatically.
    const podsAdded = await autoAttachPods(admin, data.ids);
    const r = await deliverQueued(admin, data.ids, !!data.force);
    // Then upload any picked documents onto the invoices/bills now in QuickBooks.
    return { ...r, podsAdded, ...(await sendAttachments(admin, data.ids)) };
  });

export const qbScanInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ from: z.string().max(10), to: z.string().max(10), openOnly: z.boolean(), entity: z.enum(["brokerage", "fleet"]).default("brokerage") }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const { scanInvoices } = await import("./quickbooks.server");
    // QuickBooks ids are only unique within one company, so compare against that company's rows.
    const { data: linked } = await admin.from("qb_sync").select("qb_ref").not("qb_ref", "is", null).eq("kind", data.entity === "fleet" ? "fleet_invoice" : "invoice");
    const used = new Set((linked ?? []).map((r) => String((r as { qb_ref: string }).qb_ref)));
    const invoices = await scanInvoices(admin, data.from, data.to, data.openOnly, data.entity);
    return { invoices: invoices.filter((i) => !used.has(i.id)), alreadyLinked: invoices.length - invoices.filter((i) => !used.has(i.id)).length };
  });

/** Links an existing QuickBooks invoice to a load without creating anything in QuickBooks. */
export const qbLinkInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ loadId: z.string().uuid(), qbId: z.string().min(1).max(40), amount: z.number(), paid: z.boolean(), entity: z.enum(["brokerage", "fleet"]).default("brokerage"), docNumber: z.string().max(40).nullish(), customer: z.string().max(200).nullish() }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const now = new Date().toISOString();
    // Keep QuickBooks' own invoice number + customer so the TMS shows the real invoice, not a generated INV- number.
    const real: Record<string, string> = {};
    if (data.docNumber) real.invoice_number = data.docNumber;
    if (data.customer) real.payee = data.customer;
    const kind = data.entity === "fleet" ? "fleet_invoice" : "invoice";
    // No doubles: one QuickBooks invoice can't be tied to a second load, and a load already tied to another QuickBooks invoice isn't re-pointed silently.
    const { data: taken } = await admin.from("qb_sync").select("load_id, invoice_number").eq("kind", kind).eq("qb_ref", data.qbId).neq("load_id", data.loadId).limit(1);
    if (taken?.length) {
      const { data: other } = await admin.from("loads").select("load_number").eq("id", (taken[0] as { load_id: string }).load_id).maybeSingle();
      throw new Error(`QuickBooks invoice #${data.docNumber ?? data.qbId} is already linked to load ${(other as { load_number?: string } | null)?.load_number ?? "another load"}.`);
    }
    const { data: ex } = await admin.from("qb_sync").select("id, qb_ref, invoice_number").eq("load_id", data.loadId).eq("kind", kind).maybeSingle();
    const exRow = ex as { id: string; qb_ref: string | null; invoice_number: string | null } | null;
    if (exRow?.qb_ref && exRow.qb_ref !== data.qbId) throw new Error(`This load is already linked to QuickBooks invoice #${exRow.invoice_number ?? exRow.qb_ref}. Use Link QB invoice in Accounting to verify and replace the assignment, or Remove assignment to release it. Do not void a valid QuickBooks invoice.`);
    if (ex) await admin.from("qb_sync").update({ ...real, qb_ref: data.qbId, status: "sent", error: null, sent_at: now }).eq("id", (ex as { id: string }).id);
    else {
      const { data: ins, error } = await admin.from("qb_sync").insert({ ...real, load_id: data.loadId, kind: data.entity === "fleet" ? "fleet_invoice" : "invoice", amount: data.amount, status: "sent", qb_ref: data.qbId, sent_at: now, created_by: context.userId } as never).select("id").single();
      if (error) throw new Error(error.message);
      // The numbering trigger may assign an INV-/FF- number on insert; restore the real one.
      if (ins && data.docNumber) await admin.from("qb_sync").update({ invoice_number: data.docNumber }).eq("id", (ins as { id: string }).id);
    }
    const { error: le } = await context.supabase.from("loads").update({ status: data.paid ? "paid" : "invoiced" }).eq("id", data.loadId).in("status", ["booked", "dispatched", "rolling", "delivered", "issue", "invoiced"]);
    return { ok: true, statusNote: le?.message ?? null };
  });

const entityZ = z.enum(["brokerage", "fleet"]);

export const qbFindExistingInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rowId: z.string().uuid(), value: z.string().trim().min(1).max(40), by: z.enum(["number", "id"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const { data: row, error } = await context.supabase.from("qb_sync").select("kind").eq("id", data.rowId).single();
    if (error || !row || row.kind === "bill") throw new Error("Customer invoice not found.");
    const { lookupExistingInvoice, entityForKind } = await import("./quickbooks.server");
    return { invoices: await lookupExistingInvoice(admin, entityForKind(row.kind), data.value, data.by) };
  });

export const qbRemoveInvoiceAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rowId: z.string().uuid(), previousRef: z.string().min(1).max(40).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    const { data: row, error } = await context.supabase.from("qb_sync").select("id, kind, invoice_number, qb_ref").eq("id", data.rowId).single();
    if (error || !row || row.kind === "bill") throw new Error("Customer invoice not found.");
    if (row.qb_ref !== data.previousRef) throw new Error("The invoice link changed. Close this window and try again.");
    let query = context.supabase.from("qb_sync").select("id, qb_ref").eq("kind", row.kind);
    query = row.invoice_number ? query.eq("invoice_number", row.invoice_number) : query.eq("id", row.id);
    query = data.previousRef ? query.eq("qb_ref", data.previousRef) : query.is("qb_ref", null);
    const { data: group, error: groupError } = await query;
    if (groupError || !group?.length) throw new Error("Invoice group could not be read.");
    if (group.some((g) => g.qb_ref !== data.previousRef)) throw new Error("Combined invoice has different QuickBooks links. Review it before removing.");
    const { manualInvoiceUnlinkPatch } = await import("./qbManualLink");
    const ids = group.map((g) => g.id);
    let update = context.supabase.from("qb_sync").update(manualInvoiceUnlinkPatch()).in("id", ids).eq("kind", row.kind);
    update = data.previousRef ? update.eq("qb_ref", data.previousRef) : update.is("qb_ref", null);
    const { data: updated, error: saveError } = await update.select("id");
    if (saveError) throw new Error(saveError.message);
    if (updated?.length !== ids.length) throw new Error("The invoice changed while saving. Refresh and review its link.");
    return { count: ids.length };
  });

export const qbAssignExistingInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rowId: z.string().uuid(), qbId: z.string().min(1).max(40), previousRef: z.string().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const { data: row, error } = await context.supabase.from("qb_sync").select("id, kind, invoice_number, qb_ref").eq("id", data.rowId).single();
    if (error || !row || row.kind === "bill") throw new Error("Customer invoice not found.");
    if (row.qb_ref !== data.previousRef) throw new Error("The invoice link changed. Close this window and try again.");
    const { lookupExistingInvoice, entityForKind, listInvoiceFiles } = await import("./quickbooks.server");
    const { manualInvoiceLinkPatch } = await import("./qbManualLink");
    const entity = entityForKind(row.kind);
    const [invoice] = await lookupExistingInvoice(admin, entity, data.qbId, "id");
    if (!invoice?.docNumber) throw new Error("QuickBooks didn't return an invoice number.");
    let groupQuery = context.supabase.from("qb_sync").select("id, qb_ref, attachments").eq("kind", row.kind);
    groupQuery = row.invoice_number ? groupQuery.eq("invoice_number", row.invoice_number) : groupQuery.eq("id", row.id);
    groupQuery = row.qb_ref ? groupQuery.eq("qb_ref", row.qb_ref) : groupQuery.is("qb_ref", null);
    const { data: group, error: groupError } = await groupQuery;
    if (groupError || !group?.length) throw new Error("Invoice group could not be read.");
    if (group.some((g) => g.qb_ref !== data.previousRef)) throw new Error("Combined invoice has different QuickBooks links. Review it before assigning.");
    const ids = group.map((g) => g.id);
    const { data: used, error: usedError } = await context.supabase.from("qb_sync").select("id, invoice_number").eq("kind", row.kind).eq("qb_ref", invoice.id);
    if (usedError) throw new Error(usedError.message);
    if (used?.some((u) => !ids.includes(u.id))) throw new Error(`QuickBooks invoice ${invoice.docNumber} is already assigned to TMS invoice ${used.filter((u) => !ids.includes(u.id)).map((u) => u.invoice_number || u.id).join(", ")}. Open that invoice's Link QB invoice window and confirm Remove assignment first, then assign it here. Nothing needs to be deleted in QuickBooks.`);
    // Retain files already present on the replacement invoice, so the next sync won't upload them twice.
    const { parseAttachments } = await import("./qbAttachments");
    const patch = manualInvoiceLinkPatch(row.qb_ref, invoice, new Date().toISOString());
    if (row.qb_ref !== invoice.id) {
      const files = await listInvoiceFiles(admin, entity, [invoice.id]);
      const names = new Set(files.map((f) => f.name));
      patch.attachments_sent = group.flatMap((g) => parseAttachments(g.attachments).filter((a) => names.has(a.name)).map((a) => a.path));
    }
    let update = context.supabase.from("qb_sync").update(patch).in("id", ids).eq("kind", row.kind);
    update = row.qb_ref ? update.eq("qb_ref", row.qb_ref) : update.is("qb_ref", null);
    const { data: updated, error: saveError } = await update.select("id");
    if (saveError) throw new Error(saveError.message);
    if (updated?.length !== ids.length) throw new Error("The invoice changed while saving. Refresh and review its link.");
    return { invoiceNumber: invoice.docNumber, count: ids.length };
  });

/** Lists files attached to QuickBooks invoices — by invoice id, or every invoice linked to a load. Read-only. */
export const qbInvoiceFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ loadId: z.string().uuid().optional(), entity: entityZ.optional(), qbIds: z.array(z.string().min(1).max(40)).max(25).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireStaff(context as never);
    const { listInvoiceFiles, entityForKind } = await import("./quickbooks.server");
    const groups = new Map<"brokerage" | "fleet", string[]>();
    if (data.loadId) {
      // RLS check: the caller must be able to see this load.
      const { data: vis } = await context.supabase.from("loads").select("id").eq("id", data.loadId).maybeSingle();
      if (!vis) throw new Error("Load not found.");
      const { data: rows } = await admin.from("qb_sync").select("kind, qb_ref").eq("load_id", data.loadId).in("kind", ["invoice", "fleet_invoice"]).not("qb_ref", "is", null);
      for (const r of (rows ?? []) as { kind: string; qb_ref: string }[]) { const e = entityForKind(r.kind); groups.set(e, [...(groups.get(e) ?? []), r.qb_ref]); }
    } else if (data.entity && data.qbIds?.length) groups.set(data.entity, data.qbIds);
    const files = [];
    for (const [e, ids] of groups) files.push(...(await listInvoiceFiles(admin, e, ids)).map((f) => ({ ...f, entity: e })));
    return { files, linked: groups.size > 0 };
  });

/** Copies a QuickBooks invoice attachment onto a load (as POD or another type); optionally marks POD received and closes the load out. */
export const qbImportFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ loadId: z.string().uuid(), entity: entityZ, attachableId: z.string().min(1).max(40), type: z.enum(["pod", "bol", "other"]), markPod: z.boolean(), closeout: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireStaff(context as never);
    const { data: load } = await context.supabase.from("loads").select("id, status, closed_at").eq("id", data.loadId).maybeSingle();
    if (!load) throw new Error("Load not found.");
    const { downloadInvoiceFile } = await import("./quickbooks.server");
    // Same QuickBooks file never copied twice onto a load.
    const tag = `qb${data.attachableId.replace(/[^\w]/g, "")}`;
    const { data: existing } = await admin.storage.from("load-docs").list(data.loadId, { limit: 500 });
    let path = (existing ?? []).map((f) => `${data.loadId}/${f.name}`).find((p) => p.includes(`-${tag}-`));
    if (!path) {
      const f = await downloadInvoiceFile(admin, data.entity, data.attachableId);
      path = `${data.loadId}/${data.type}-${tag}-${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error } = await admin.storage.from("load-docs").upload(path, f.bytes, { contentType: f.contentType });
      if (error) throw new Error(error.message);
    }
    const notes: string[] = [];
    if (data.markPod) {
      const { error } = await context.supabase.from("loads").update({ pod_received: true }).eq("id", data.loadId);
      if (error) notes.push(`POD box not ticked: ${error.message}`);
    }
    if (data.closeout && !load.closed_at) {
      const { data: res, error } = await context.supabase.rpc("batch_load_action", { _ids: [data.loadId], _action: "closeout", _note: "POD reviewed from QuickBooks invoice" });
      const r = (res as { ok: boolean; error?: string }[] | null)?.[0];
      if (error || (r && !r.ok)) notes.push(`Not closed out: ${error?.message ?? r?.error}`);
    }
    return { path, notes };
  });
