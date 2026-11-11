import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { paidLoadIds, type PaidRow } from "./qbPaid";

type Rpc = { rpc: (f: string, a: object) => Promise<{ data: boolean }> };
async function finance(ctx: { supabase: unknown; userId: string }) {
  const { data } = await (ctx.supabase as Rpc).rpc("is_finance", { _uid: ctx.userId });
  if (!data) throw new Error("Admins or accountants only.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
type Admin = Awaited<ReturnType<typeof finance>>;
export type PaidItem = { loadId: string; loadNumber: string; status: string; closed: boolean; entity: "brokerage" | "fleet"; invoiceNumber: string | null; customer: string; total: number; qbDate: string | null };

/** Reads both QuickBooks companies (read-only) for linked customer invoices with no balance, on loads not yet marked paid. */
async function findPaid(admin: Admin, onlyIds?: string[]) {
  const { invoiceBalances } = await import("./quickbooks.server");
  let q = admin.from("qb_sync").select("load_id, qb_ref, kind, invoice_number, loads!inner(load_number, status, closed_at)").in("kind", ["invoice", "fleet_invoice"]).not("qb_ref", "is", null).not("loads.status", "in", "(paid,cancelled)").limit(5000);
  if (onlyIds) q = q.in("load_id", onlyIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as { load_id: string; qb_ref: string; kind: string; invoice_number: string | null; loads: { load_number: string; status: string; closed_at: string | null } }[];
  const items: PaidItem[] = []; const skipped: string[] = [];
  for (const entity of ["brokerage", "fleet"] as const) {
    const mine = rows.filter((r) => (r.kind === "fleet_invoice") === (entity === "fleet"));
    if (!mine.length) continue;
    let bal: Awaited<ReturnType<typeof invoiceBalances>>;
    try { bal = await invoiceBalances(admin, entity, mine.map((r) => r.qb_ref)); } catch (e) { skipped.push((e as Error).message); continue; }
    const pr: PaidRow[] = mine.map((r) => ({ loadId: r.load_id, qbRef: r.qb_ref, balance: bal.get(r.qb_ref)?.balance ?? null }));
    const paid = paidLoadIds(pr);
    const seen = new Set<string>();
    for (const r of mine) {
      if (!paid.has(r.load_id) || seen.has(r.load_id)) continue;
      seen.add(r.load_id);
      const b = bal.get(r.qb_ref)!;
      items.push({ loadId: r.load_id, loadNumber: r.loads.load_number, status: r.loads.status, closed: !!r.loads.closed_at, entity, invoiceNumber: b.docNumber ?? r.invoice_number, customer: b.customer, total: b.total, qbDate: b.date });
    }
  }
  return { items, skipped };
}

export const qbPaidCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => findPaid(await finance(context as never)));

/** Re-checks QuickBooks, then marks the picked loads Paid (and optionally closes them out) as the signed-in user. */
export const qbMarkPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ loadIds: z.array(z.string().uuid()).min(1).max(500), closeout: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await finance(context as never);
    const { items } = await findPaid(admin, data.loadIds);
    const ok = new Set(items.map((i) => i.loadId));
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of data.loadIds) {
      if (!ok.has(id)) { results.push({ id, ok: false, error: "QuickBooks no longer shows this invoice as fully paid." }); continue; }
      const { error } = await context.supabase.from("loads").update({ status: "paid" }).eq("id", id);
      if (error) { results.push({ id, ok: false, error: error.message }); continue; }
      if (data.closeout) {
        const { error: ce } = await context.supabase.rpc("batch_load_action", { _ids: [id], _action: "closeout", _note: "Customer paid in QuickBooks" });
        if (ce) { results.push({ id, ok: false, error: `Marked paid, closeout failed: ${ce.message}` }); continue; }
      }
      results.push({ id, ok: true });
    }
    return { results };
  });
