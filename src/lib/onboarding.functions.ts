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
        .select("legal_name,dba,mc_number,dot_number,phone,email,contact_name,city,state,equipment,pay_terms,factoring_company,factoring_remit,factoring_remit_address")
        .eq("id", inv.carrier_id)
        .single();
      if (c) {
        const { factoring_remit_address, ...rest } = c;
        carrier = { ...rest, factoring_remit: c.factoring_remit_address || c.factoring_remit };
      }
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
  factoring_remit: z.string().max(400).optional(),
  pay_terms: z.enum(["net30", "quickpay", "factoring", "factored_quickpay"]).default("net30"),
  agreement_accepted: z.literal(true),
  signer_name: z.string().trim().min(2).max(120),
  files: z.array(fileSchema).min(1).max(8),
});

export const submitPacket = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => submitSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, inv, problem } = await loadInvite(data.token);
    if (problem || !inv) return { ok: false as const, problem: problem ?? "Invalid link" };
    const factored = data.pay_terms === "factoring" || data.pay_terms === "factored_quickpay";
    // Only keep files that belong to the chosen pay option (no voided check for factored carriers, no NOA otherwise).
    data.files = data.files.filter((f) => (f.kind === "noa" ? factored : f.kind === "voided_check" ? !factored : true));
    const kinds = new Set(data.files.map((f) => f.kind));
    if (!kinds.has("w9") || !kinds.has("coi")) return { ok: false as const, problem: "A W-9 and a certificate of insurance are required." };
    if (factored && !kinds.has("noa")) return { ok: false as const, problem: "Please attach your factoring Notice of Assignment." };

    const i = data.info;
    const fields = {
      legal_name: i.legal_name, dba: i.dba || null, mc_number: i.mc_number || null, dot_number: i.dot_number || null,
      contact_name: i.contact_name || null, phone: i.phone || null, email: i.email, city: i.city || null,
      state: i.state?.toUpperCase() || null, equipment: i.equipment || null,
      auto_liability: data.insurance.auto_liability, insurance_expires: data.insurance.auto_expires,
      cargo_insurance: data.insurance.cargo_insurance, cargo_expires: data.insurance.cargo_expires,
      factoring_company: factored ? data.factoring_company || null : null,
      factoring_remit: factored ? data.factoring_remit || null : null,
      factoring_remit_address: factored ? data.factoring_remit || null : null,
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
      let expires = f.kind === "coi" ? data.insurance.auto_expires : null;
      const key = process.env["LOVABLE_API_KEY"];
      if (f.kind === "coi" && key) {
        // The certificate itself is the source of truth for limits and dates.
        try {
          const { readCoi, coiPatch } = await import("./coi.server");
          const p = await readCoi(f.base64, f.name, f.type, key);
          if (p) {
            await supabaseAdmin.from("carriers").update(coiPatch(p) as never).eq("id", carrierId);
            expires = p.auto_expires ?? expires;
          }
        } catch (e) { console.error("COI read failed", e); }
      }
      await supabaseAdmin.from("carrier_documents").insert({
        carrier_id: carrierId, kind: f.kind, file_path: path, file_name: f.name, source: "carrier portal",
        expires_on: expires,
      });
    }
    // Signed PDF of the exact agreement text shown on the portal, plus a signature certificate page.
    const signedAt = new Date().toISOString();
    const { addSignatureCertificate, sha256Hex, stableJson, requestSigner, ESIGN_CONSENT } = await import("./esign");
    const { agreementLegalHtml } = await import("@/content/agreement-legal");
    const { ip, ua } = await requestSigner();
    const reference = `CWA-${inv.id.slice(0, 8).toUpperCase()}`;
    const termsSha = await sha256Hex(stableJson({ agreement: agreementLegalHtml, carrier: i, pay_terms: data.pay_terms }));
    let agreementPath = "";
    let docSha: string | null = null;
    try {
      const { buildAgreementPdf } = await import("./agreementPdf");
      const pdf = buildAgreementPdf({ ...i, pay_terms: data.pay_terms, signer_name: data.signer_name, signed_at: signedAt, signer_ip: ip, reference });
      addSignatureCertificate(pdf, {
        document: "Broker-Carrier Agreement", reference,
        parties: `Clearwater Cargo LLC (broker) and ${i.legal_name}${i.mc_number ? ` (MC ${i.mc_number})` : ""} (carrier)`,
        signer: data.signer_name, sentTo: inv.email, signedAt, ip, device: ua, consent: ESIGN_CONSENT, termsSha256: termsSha,
      });
      const bytes = new Uint8Array(pdf.output("arraybuffer"));
      docSha = await sha256Hex(bytes);
      agreementPath = `${carrierId}/agreement-signed-${Date.now()}.pdf`;
      const { error } = await supabaseAdmin.storage.from("carrier-docs").upload(agreementPath, bytes, { contentType: "application/pdf" });
      if (error) { console.error(error); agreementPath = ""; docSha = null; }
    } catch (e) { console.error("Agreement PDF failed", e); agreementPath = ""; docSha = null; }
    await supabaseAdmin.from("carrier_documents").insert({
      carrier_id: carrierId, kind: "agreement", file_path: agreementPath,
      file_name: `Broker-Carrier Agreement — signed by ${data.signer_name} ${signedAt.slice(0, 10)}.pdf`, source: "carrier portal",
    });
    await supabaseAdmin.from("carrier_signatures").insert({
      carrier_id: carrierId, external_ref: reference, source: "carrier portal", signer_name: data.signer_name,
      signed_at: signedAt, signer_ip: ip, user_agent: ua, pay_type: data.pay_terms,
      consent_text: ESIGN_CONSENT, terms_sha256: termsSha, doc_sha256: docSha, file_path: agreementPath || null,
    });
    await supabaseAdmin.from("carrier_invites").update({ status: "submitted", submitted_at: new Date().toISOString(), carrier_id: carrierId }).eq("id", inv.id);
    return { ok: true as const };
  });
