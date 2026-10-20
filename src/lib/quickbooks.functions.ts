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
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await requireStaff(context as never);
    const { deliverQueued } = await import("./quickbooks.server");
    return deliverQueued(admin, data.ids);
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
  .inputValidator((d) => z.object({ loadId: z.string().uuid(), qbId: z.string().min(1).max(40), amount: z.number(), paid: z.boolean(), entity: z.enum(["brokerage", "fleet"]).default("brokerage") }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const now = new Date().toISOString();
    const { data: ex } = await admin.from("qb_sync").select("id").eq("load_id", data.loadId).eq("kind", data.entity === "fleet" ? "fleet_invoice" : "invoice").maybeSingle();
    if (ex) await admin.from("qb_sync").update({ qb_ref: data.qbId, status: "sent", error: null, sent_at: now }).eq("id", (ex as { id: string }).id);
    else {
      const { error } = await admin.from("qb_sync").insert({ load_id: data.loadId, kind: data.entity === "fleet" ? "fleet_invoice" : "invoice", amount: data.amount, status: "sent", qb_ref: data.qbId, sent_at: now, created_by: context.userId } as never);
      if (error) throw new Error(error.message);
    }
    const { error: le } = await context.supabase.from("loads").update({ status: data.paid ? "paid" : "invoiced" }).eq("id", data.loadId).in("status", ["delivered", "invoiced"]);
    return { ok: true, statusNote: le?.message ?? null };
  });
