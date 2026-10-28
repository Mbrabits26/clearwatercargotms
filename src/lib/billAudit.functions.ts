import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  fileName: z.string().max(200),
  mime: z.string().max(100),
  base64: z.string().max(14_000_000),
});

const PROMPT = `You read a motor carrier's freight invoice that was billed to Clearwater Cargo (the freight broker).
Return null for anything not on the document — never guess.
- invoice_number: the carrier's own invoice number.
- load_ref: the broker load #, rate con #, or PRO the invoice references.
- total: the total amount due on the invoice in dollars (the invoice's own total, before any quick pay discount the broker takes).
- lines: every charge line as {description, amount}: linehaul/freight, fuel, detention, lumper, layover, TONU, extra stops, etc. Use negative amounts for credits or deductions.`;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["invoice_number", "load_ref", "carrier_name", "total", "lines"],
  properties: {
    invoice_number: { type: ["string", "null"] },
    load_ref: { type: ["string", "null"] },
    carrier_name: { type: ["string", "null"] },
    total: { type: ["number", "null"] },
    lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["description", "amount"], properties: { description: { type: "string" }, amount: { type: "number" } } } },
  },
};
export type CarrierInvoiceRead = { invoice_number: string | null; load_ref: string | null; carrier_name: string | null; total: number | null; lines: { description: string; amount: number }[] };

/** Reads a carrier's invoice (PDF/photo) so the bill can be audited against the rate con. Read-only. */
export const readCarrierInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Document reader is not configured.");
    const parts: Record<string, unknown>[] = [];
    if (data.mime === "application/pdf") parts.push({ type: "input_file", filename: data.fileName, file_data: `data:application/pdf;base64,${data.base64}` });
    else if (data.mime.startsWith("image/")) parts.push({ type: "input_image", image_url: `data:${data.mime};base64,${data.base64}` });
    else throw new Error("Upload the carrier invoice as a PDF or photo.");
    const { readDocJson } = await import("./extract.server");
    const out = await readDocJson({ instructions: PROMPT, ask: "Read this carrier invoice.", name: "carrier_invoice", schema: SCHEMA }, parts, key);
    return out as CarrierInvoiceRead;
  });
