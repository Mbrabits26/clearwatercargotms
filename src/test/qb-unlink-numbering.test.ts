import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { manualInvoiceLinkPatch, manualInvoiceUnlinkPatch } from "../lib/qbManualLink";
import { correctionPlan } from "../lib/qbCorrection";

const url = process.env.SUPABASE_DB_URL;
const db = url ? postgres(url, { max: 1, prepare: false }) : null;
afterAll(async () => { if (db) await db.end(); });

describe.skipIf(!db)("live invoice-number trigger for assignment corrections", () => {
  it("saves both linked groups atomically and rolls back on a stale link", async () => {
    if (!db) throw new Error("Database test connection required");
    try {
      await db.begin(async (sql) => {
        const [finance] = await sql`SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1`;
        if (!finance) throw new Error("Finance test user required");
        await sql`SELECT set_config('request.jwt.claim.sub', ${finance.user_id}, true)`;
        const rows = await sql`SELECT id, kind, invoice_number, qb_ref, amount, status FROM public.qb_sync WHERE kind = 'fleet_invoice' AND qb_ref IS NOT NULL ORDER BY id LIMIT 2`;
        expect(rows.length).toBe(2);
        const groups = [];
        for (const r of rows) groups.push(await sql`SELECT id, kind, invoice_number, qb_ref FROM public.qb_sync WHERE kind = ${r.kind} AND invoice_number = ${r.invoice_number} AND qb_ref = ${r.qb_ref}`);
        const a = rows[0], b = rows[1];
        if (!a || !b || !groups[0] || !groups[1]) throw new Error("Two invoice groups required");
        const invoice = (r: typeof a) => ({ id: r.qb_ref, docNumber: r.invoice_number, customer: "Verified test", total: Number(r.amount), balance: 0, date: "2026-11-13", text: "", lines: [] });
        const plan = [...correctionPlan(groups[0] as never, "a", invoice(b), "existing", "fleet_invoice"), ...correctionPlan(groups[1] as never, "b", invoice(a), "previous", "fleet_invoice")];
        // The sandbox connection cannot execute finance-only RPCs. Exercise an identical
        // transaction-local copy of the deployed function; it rolls back with all test writes.
        const [definition] = await sql`SELECT pg_get_functiondef('public.apply_invoice_correction(jsonb)'::regprocedure) AS body`;
        if (!definition) throw new Error("Correction function required");
        await sql.unsafe(String(definition.body).replace("public.apply_invoice_correction", "pg_temp.test_invoice_correction").replace("auth.uid()", "current_setting('request.jwt.claim.sub')::uuid"));
        await sql`SELECT pg_temp.test_invoice_correction(${sql.json(plan)})`;
        const [afterA] = await sql`SELECT qb_ref, invoice_number, amount FROM public.qb_sync WHERE id = ${a.id}`;
        const [afterB] = await sql`SELECT qb_ref, invoice_number, amount FROM public.qb_sync WHERE id = ${b.id}`;
        expect(afterA).toMatchObject({ qb_ref: b.qb_ref, invoice_number: b.invoice_number, amount: a.amount });
        expect(afterB).toMatchObject({ qb_ref: a.qb_ref, invoice_number: a.invoice_number, amount: b.amount });
        await expect(sql.savepoint(async (sp) => { await sp`SELECT pg_temp.test_invoice_correction(${sp.json(plan)})`; })).rejects.toThrow("changed");
        const [unchanged] = await sql`SELECT qb_ref FROM public.qb_sync WHERE id = ${a.id}`;
        expect(unchanged?.qb_ref).toBe(b.qb_ref);
        throw new Error("ROLLBACK_VERIFIED_TEST");
      });
    } catch (e) { if (!(e instanceof Error) || e.message !== "ROLLBACK_VERIFIED_TEST") throw e; }
  });
  it.each(["fleet_invoice", "invoice"])("keeps %s blank until a verified QuickBooks invoice is chosen", async (kind) => {
    if (!db) throw new Error("Database test connection required");
    await db.begin(async (sql) => {
      // Exercise the deployed trigger without changing real invoices or consuming sequence numbers.
      await sql`CREATE TEMP TABLE unlink_number_test (kind text, qb_class text, invoice_number text, status text, qb_ref text) ON COMMIT DROP`;
      await sql`CREATE TRIGGER invoice_number_test BEFORE INSERT OR UPDATE OF invoice_number, kind ON unlink_number_test FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_number()`;
      await sql`INSERT INTO unlink_number_test VALUES (${kind}, NULL, '2165', 'sent', '5048')`;
      const patch = manualInvoiceUnlinkPatch();
      const [removed] = await sql`UPDATE unlink_number_test SET invoice_number = ${patch.invoice_number}, qb_ref = ${patch.qb_ref}, status = ${patch.status} RETURNING *`;
      expect(removed).toMatchObject({ invoice_number: null, qb_ref: null, status: "hold" });
      // Re-saving while searching must not allocate an FF-/INV- number either.
      const [saved] = await sql`UPDATE unlink_number_test SET invoice_number = NULL RETURNING *`;
      expect(saved?.invoice_number).toBeNull();
      const linked = manualInvoiceLinkPatch(null, { id: "5094", docNumber: "FF-1018", customer: "Madison Wood", total: 1625, balance: 0, date: "2026-11-13", text: "40115924", lines: [] }, "2026-11-13T19:29:00Z");
      const [assigned] = await sql`UPDATE unlink_number_test SET invoice_number = ${linked.invoice_number}, qb_ref = ${linked.qb_ref}, status = ${linked.status} RETURNING *`;
      expect(assigned).toMatchObject({ invoice_number: "FF-1018", qb_ref: "5094", status: "sent" });
    });
  });
});