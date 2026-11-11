import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const n = (t: string) => ({ type: [t, "null"] });
const FIELDS = {
  factoring_company: n("string"), remit_address: n("string"), remit_email: n("string"),
  bank_name: n("string"), account_name: n("string"), routing_number: n("string"), account_number: n("string"),
  account_type: n("string"), method: n("string"),
};
type Noa = Record<keyof typeof FIELDS, string | null>;

/** Reads an uploaded NOA, fills blank factoring fields on the carrier and (finance only) blank payment-account fields. */
export const readNoaDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ carrierId: z.string().uuid(), docId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: staff } = await sb.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const { data: doc } = await sb.from("carrier_documents").select("*").eq("id", data.docId).eq("carrier_id", data.carrierId).single();
    if (!doc?.file_path) throw new Error("Document not found");
    const { data: blob } = await sb.storage.from("carrier-docs").download(doc.file_path);
    if (!blob || blob.size > 9_000_000) throw new Error("File too large to read");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI not configured");
    const name = doc.file_name ?? doc.file_path;
    const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    const part = /\.pdf$/i.test(name) || blob.type === "application/pdf"
      ? { type: "input_file", filename: name, file_data: `data:application/pdf;base64,${b64}` }
      : { type: "input_image", image_url: `data:${blob.type || "image/jpeg"};base64,${b64}` };
    const { readDocJson } = await import("./extract.server");
    const p = (await readDocJson({
      instructions: "You read trucking Notice of Assignment (NOA) letters from factoring companies. Return the factoring company legal name, the remit-to mailing address (one line), remittance email, bank name, account holder name, ABA routing number (9 digits only), account number (digits only), account type ('checking' or 'savings'), and method ('ach', 'wire' or 'check' — ach if bank details are given, check if only a mailing address). Use null when not shown; never guess.",
      ask: "Extract the payment details from this notice of assignment.", name: "noa",
      schema: { type: "object", additionalProperties: false, required: Object.keys(FIELDS), properties: FIELDS },
    }, [part], key)) as Noa;
    const digits = (s: string | null) => (s ? s.replace(/\D/g, "") : "") || null;
    const routing = digits(p.routing_number); const routingOk = routing && routing.length === 9 ? routing : null;
    const { data: car } = await sb.from("carriers").select("factoring_company, factoring_remit_address").eq("id", data.carrierId).single();
    const cPatch: Record<string, unknown> = { noa_received: true };
    if (p.factoring_company && !car?.factoring_company) cPatch.factoring_company = p.factoring_company;
    if (p.remit_address && !car?.factoring_remit_address) cPatch.factoring_remit_address = p.remit_address;
    await sb.from("carriers").update(cPatch as never).eq("id", data.carrierId);
    const filled: string[] = Object.keys(cPatch).filter((k) => k !== "noa_received");
    let bankSaved = false; let bankSkipped = "";
    const { data: fin } = await sb.rpc("is_finance", { _uid: context.userId });
    const bank = { bank_name: p.bank_name, account_name: p.account_name, routing_number: routingOk, account_number: digits(p.account_number), account_type: p.account_type?.toLowerCase() === "savings" ? "savings" : p.account_type ? "checking" : null, remit_email: p.remit_email };
    const hasBank = Object.values(bank).some(Boolean);
    if (hasBank && !fin) bankSkipped = "Bank details were found but only admins/accountants can save them.";
    else if (hasBank) {
      const { data: acct } = await sb.from("carrier_payment_accounts").select("*").eq("carrier_id", data.carrierId).maybeSingle();
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(bank)) if (v && !(acct as Record<string, unknown> | null)?.[k]) patch[k] = v;
      if (!acct) patch.method = ["ach", "wire", "check"].includes(p.method ?? "") ? p.method : bank.routing_number ? "ach" : "check";
      if (Object.keys(patch).length) {
        const { error } = await sb.from("carrier_payment_accounts").upsert({ carrier_id: data.carrierId, ...(acct ?? {}), ...patch } as never);
        if (error) bankSkipped = `Could not save bank details: ${error.message}`; else { bankSaved = true; filled.push(...Object.keys(patch).filter((k) => k !== "method")); }
      }
    }
    const last4 = (s: string | null) => (s ? `••••${s.slice(-4)}` : null);
    return { found: !!(p.factoring_company || hasBank), filled, bankSaved, bankSkipped,
      noa: { factoring_company: p.factoring_company, remit_address: p.remit_address, remit_email: p.remit_email, bank_name: p.bank_name, routing: last4(routingOk), account: last4(digits(p.account_number)) } };
  });
