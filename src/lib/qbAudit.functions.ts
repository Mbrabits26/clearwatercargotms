import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuditInvoice, PaymentDoc } from "./qbAudit";

type Rpc = { rpc: (f: string, a: object) => Promise<{ data: boolean }> };
async function requireFinance(ctx: { supabase: unknown; userId: string }) {
  const { data } = await (ctx.supabase as Rpc).rpc("is_finance", { _uid: ctx.userId });
  if (!data) throw new Error("Admins or accountants only.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Every QB invoice from both companies (read-only) since `from`, tagged with its linked TMS load. */
async function loadBook(admin: Awaited<ReturnType<typeof requireFinance>>, from: string): Promise<{ invoices: AuditInvoice[]; skipped: string[] }> {
  const { scanInvoices } = await import("./quickbooks.server");
  const { data: syncs } = await admin.from("qb_sync").select("qb_ref, kind, load_id, loads(load_number)").not("qb_ref", "is", null).in("kind", ["invoice", "fleet_invoice"]).limit(5000);
  const link = new Map<string, { id: string; num: string | null }>();
  for (const s of (syncs ?? []) as unknown as { qb_ref: string; kind: string; load_id: string; loads: { load_number: string } | null }[])
    link.set(`${s.kind === "fleet_invoice" ? "fleet" : "brokerage"}|${s.qb_ref}`, { id: s.load_id, num: s.loads?.load_number ?? null });
  const invoices: AuditInvoice[] = [];
  const skipped: string[] = [];
  for (const entity of ["brokerage", "fleet"] as const) {
    try {
      const list = await scanInvoices(admin, from, "", false, entity);
      for (const i of list) { const l = link.get(`${entity}|${i.id}`); invoices.push({ ...i, entity, loadId: l?.id ?? null, loadNumber: l?.num ?? null }); }
    } catch (e) { skipped.push((e as Error).message); }
  }
  return { invoices, skipped };
}

const fromZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const qbDuplicateAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ from: fromZ }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireFinance(context as never);
    const { findDuplicates } = await import("./qbAudit");
    const { invoices, skipped } = await loadBook(admin, data.from);
    return {
      pairs: findDuplicates(invoices),
      counts: { brokerage: invoices.filter((i) => i.entity === "brokerage").length, fleet: invoices.filter((i) => i.entity === "fleet").length },
      skipped,
    };
  });

const PAY_PROMPT = `You read customer payment documents for a freight broker: check stubs, remittance advices, ACH/EFT payment notices, bank deposit details, factoring remittances.
Return the payer company, check/ACH/reference number, payment date (YYYY-MM-DD), the total paid, and one line per invoice paid.
For each line, ref is the invoice number exactly as printed (or the PO / load / BOL number if no invoice number is shown), and amount is the amount paid on that line.
Never return bank account or routing numbers. Use null when a value is not shown.`;
const PAY_SCHEMA = {
  type: "object", additionalProperties: false, required: ["payer", "check_number", "date", "total", "lines"],
  properties: {
    payer: { type: ["string", "null"] }, check_number: { type: ["string", "null"] }, date: { type: ["string", "null"] }, total: { type: ["number", "null"] },
    lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["ref", "amount"], properties: { ref: { type: ["string", "null"] }, amount: { type: ["number", "null"] } } } },
  },
};

export const qbCheckPaymentDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ fileName: z.string().max(200), mime: z.string().max(100), base64: z.string().max(14_000_000).nullable(), text: z.string().max(200_000).nullable(), from: fromZ }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await requireFinance(context as never);
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Document reader is not configured.");
    const parts: Record<string, unknown>[] = [];
    if (data.text) parts.push({ type: "input_text", text: `File ${data.fileName}:\n${data.text}` });
    else if (data.base64 && data.mime === "application/pdf") parts.push({ type: "input_file", filename: data.fileName, file_data: `data:application/pdf;base64,${data.base64}` });
    else if (data.base64 && data.mime.startsWith("image/")) parts.push({ type: "input_image", image_url: `data:${data.mime};base64,${data.base64}` });
    else throw new Error("Upload a PDF, photo, or spreadsheet.");
    const { readDocJson } = await import("./extract.server");
    const doc = (await readDocJson({ instructions: PAY_PROMPT, ask: "Read this payment document.", name: "payment", schema: PAY_SCHEMA }, parts, key)) as PaymentDoc;
    const { matchPayment } = await import("./qbAudit");
    const { invoices, skipped } = await loadBook(admin, data.from);
    return { doc, matches: matchPayment(doc, invoices), skipped };
  });
