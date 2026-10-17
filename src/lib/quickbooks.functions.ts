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
    const { data } = await admin.from("qb_connection" as never).select("company_name, connected_at, refresh_expires_at").eq("id", 1).maybeSingle();
    const d = data as { company_name: string | null; connected_at: string; refresh_expires_at: string | null } | null;
    return { connected: !!d, company: d?.company_name ?? null, connectedAt: d?.connected_at ?? null, keysSaved: !!process.env["QUICKBOOKS_CLIENT_ID"] };
  });

export const qbStartConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await requireAdmin(context as never);
    const { authorizeUrl } = await import("./quickbooks.server");
    const state = crypto.randomUUID();
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
    const company = await exchangeCode(admin, data.code, data.realmId, context.userId);
    return { company };
  });

export const qbDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await requireAdmin(context as never);
    await admin.from("qb_connection" as never).delete().eq("id", 1);
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
