import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenSchema = z.object({ token: z.string().uuid() });

async function loadInvite(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: inv } = await supabaseAdmin.from("carrier_invites").select("*").eq("token", token).maybeSingle();
  if (!inv) return { supabaseAdmin, inv: null, problem: "This onboarding link is not valid." };
  if (inv.status === "revoked") return { supabaseAdmin, inv, problem: "This onboarding link has been cancelled." };
  if (inv.status === "submitted") return { supabaseAdmin, inv, problem: "This packet was already submitted. Thank you!" };
  if (new Date(inv.expires_at) < new Date()) return { supabaseAdmin, inv, problem: "This onboarding link has expired. Ask Clearwater Cargo for a new one." };
  return { supabaseAdmin, inv, problem: null as string | null };
}

export const getInvite = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, inv, problem } = await loadInvite(data.token);
    if (problem || !inv) return { ok: false as const, problem: problem ?? "Invalid link" };
    let carrier = null as null | Record<string, string | null>;
    if (inv.carrier_id) {
      const { data: c } = await supabaseAdmin
        .from("carriers")
        .select("legal_name,dba,mc_number,dot_number,phone,email,contact_name,city,state,equipment")
        .eq("id", inv.carrier_id)
        .single();
      carrier = c;
    }
    return { ok: true as const, email: inv.email, carrier };
  });

const fileSchema = z.object({
  kind: z.enum(["w9", "coi", "agreement", "noa", "voided_check"]),
  name: z.string().max(200),
  type: z.string().max(100),
  base64: z.string().max(14_000_000),
});
const submitSchema = tokenSchema.extend({
  info: z.object({
    legal_name: z.string().trim().min(2).max(200),
    dba: z.string().max(200).optional(),
    mc_number: z.string().max(20).optional(),
    dot_number: z.string().max(20).optional(),
    contact_name: z.string().max(120).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().email().max(200),
    city: z.string().max(100).optional(),
    state: z.string().max(2).optional(),
    equipment: z.string().max(100).optional(),
  }),
  insurance: z.object({
    auto_liability: z.number().min(0).max(100_000_000),
    auto_expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cargo_insurance: z.number().min(0).max(100_000_000),
    cargo_expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  factoring_company: z.string().max(200).optional(),
  pay_terms: z.enum(["net30", "quickpay", "factored_quickpay"]).default("net30"),
  agreement_accepted: z.literal(true),
  signer_name: z.string().trim().min(2).max(120),
  files: z.array(fileSchema).min(1).max(8),
});

export const submitPacket = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => submitSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, inv, problem } = await loadInvite(data.token);
    if (problem || !inv) return { ok: false as const, problem: problem ?? "Invalid link" };
    const kinds = new Set(data.files.map((f) => f.kind));
    if (!kinds.has("w9") || !kinds.has("coi")) return { ok: false as const, problem: "A W-9 and a certificate of insurance are required." };
    if (data.factoring_company && !kinds.has("noa")) return { ok: false as const, problem: "Please attach your factoring Notice of Assignment." };

    const i = data.info;
    const fields = {
      legal_name: i.legal_name, dba: i.dba || null, mc_number: i.mc_number || null, dot_number: i.dot_number || null,
      contact_name: i.contact_name || null, phone: i.phone || null, email: i.email, city: i.city || null,
      state: i.state?.toUpperCase() || null, equipment: i.equipment || null,
      auto_liability: data.insurance.auto_liability, insurance_expires: data.insurance.auto_expires,
      cargo_insurance: data.insurance.cargo_insurance, cargo_expires: data.insurance.cargo_expires,
      factoring_company: data.factoring_company || null,
      pay_terms: data.pay_terms,
      w9_received: true, coi_received: true, agreement_signed: true,
      noa_received: kinds.has("noa"), voided_check_received: kinds.has("voided_check"),
    };
    let carrierId = inv.carrier_id;
    if (carrierId) {
      const { error } = await supabaseAdmin.from("carriers").update(fields).eq("id", carrierId);
      if (error) { console.error(error); return { ok: false as const, problem: "Could not save your details." }; }
    } else {
      const { data: c, error } = await supabaseAdmin.from("carriers").insert({ ...fields, status: "pending" }).select("id").single();
      if (error) { console.error(error); return { ok: false as const, problem: "Could not save your details." }; }
      carrierId = c.id;
    }

    for (const f of data.files) {
      const safe = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `${carrierId}/${f.kind}-${Date.now()}-${safe}`;
      const { error } = await supabaseAdmin.storage.from("carrier-docs").upload(path, Buffer.from(f.base64, "base64"), { contentType: f.type || "application/octet-stream" });
      if (error) { console.error(error); return { ok: false as const, problem: `Upload failed for ${f.name}.` }; }
      await supabaseAdmin.from("carrier_documents").insert({
        carrier_id: carrierId, kind: f.kind, file_path: path, file_name: f.name, source: "carrier portal",
        expires_on: f.kind === "coi" ? data.insurance.auto_expires : null,
      });
    }
    await supabaseAdmin.from("carrier_documents").insert({
      carrier_id: carrierId, kind: "agreement", file_path: "", file_name: `Accepted online by ${data.signer_name} on ${new Date().toISOString().slice(0, 10)}`, source: "carrier portal",
    });
    await supabaseAdmin.from("carrier_invites").update({ status: "submitted", submitted_at: new Date().toISOString(), carrier_id: carrierId }).eq("id", inv.id);
    return { ok: true as const };
  });
