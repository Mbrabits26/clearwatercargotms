import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { manualInvoiceLinkPatch, manualInvoiceUnlinkPatch } from "../lib/qbManualLink";

const url = process.env.SUPABASE_DB_URL;
const db = url ? postgres(url, { max: 1, prepare: false }) : null;
afterAll(async () => { if (db) await db.end(); });

describe.skipIf(!db)("live invoice-number trigger for assignment corrections", () => {
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