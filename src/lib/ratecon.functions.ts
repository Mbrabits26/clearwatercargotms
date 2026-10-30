import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RateConData } from "./ratecon";

const tokenSchema = z.object({ token: z.string().uuid() });

async function loadRequest(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: req } = await supabaseAdmin.from("ratecon_requests").select("*").eq("token", token).maybeSingle();
  let problem: string | null = null;
  if (!req) problem = "This signing link is not valid.";
  else if (req.status === "void") problem = "This rate confirmation was cancelled. Contact Clearwater Cargo for an updated one.";
  else if (req.status === "signed") problem = "This rate confirmation has already been signed. Thank you!";
  else if (new Date(req.expires_at) < new Date()) problem = "This signing link has expired. Contact Clearwater Cargo for a new one.";
  return { supabaseAdmin, req, problem };
}

const SITE = "https://tms.clearwatercargo.com";

export const getRateConForSigning = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, req, problem } = await loadRequest(data.token);
    if (req && req.status === "signed" && req.pdf_path) {
      const { data: s } = await supabaseAdmin.storage.from("load-docs").createSignedUrl(req.pdf_path, 60 * 60);
      const rc = req.snapshot as unknown as RateConData;
      return {
        ok: false as const, signed: true as const, problem: problem ?? "",
        rcNumber: rc.rc, signerName: req.signer_name, signedAt: req.signed_at, downloadUrl: s?.signedUrl ?? null,
      };
    }
    if (problem || !req) return { ok: false as const, signed: false as const, problem: problem ?? "Invalid link" };
    return { ok: true as const, rc: req.snapshot as unknown as RateConData };
  });

async function sendSignedEmails(supabaseAdmin: any, req: any, rc: RateConData, signerName: string, signerTitle: string | undefined, signedAt: string) {
  try {
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const when = new Date(signedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET";
    const base = {
      rc: rc.rc, lane: rc.lane, carrier: rc.carrier,
      total: `$${Number(rc.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      signerName, signerTitle, signedAt: when, downloadUrl: `${SITE}/sign/${req.token}`,
    };
    const { data: load } = await supabaseAdmin.from("loads").select("broker_id").eq("id", req.load_id).maybeSingle();
    let brokerEmail: string | null = null;
    const brokerId = load?.broker_id ?? req.created_by;
    if (brokerId) {
      const { data: p } = await supabaseAdmin.from("profiles").select("email").eq("id", brokerId).maybeSingle();
      brokerEmail = p?.email ?? null;
    }
    const jobs: Promise<unknown>[] = [];
    if (req.carrier_email) {
      jobs.push(sendTemplateEmail("ratecon-signed", req.carrier_email, {
        templateData: { ...base, audience: "carrier" },
        idempotencyKey: `ratecon-signed-carrier-${req.id}`,
        replyTo: brokerEmail ?? "admin@clearwatercargo.com",
      }));
    }
    const brokerData = { ...base, audience: "broker", loadUrl: `${SITE}/dispatch` };
    const { wantsEmail, wantsEmailByAddress } = await import("./notifyPrefs.server");
    if (brokerEmail && await wantsEmail(supabaseAdmin, brokerId, "email_ratecon_signed")) {
      jobs.push(sendTemplateEmail("ratecon-signed", brokerEmail, { templateData: brokerData, idempotencyKey: `ratecon-signed-broker-${req.id}` }));
    }
    if (brokerEmail?.toLowerCase() !== "admin@clearwatercargo.com" && await wantsEmailByAddress(supabaseAdmin, "admin@clearwatercargo.com", "email_ratecon_signed")) {
      jobs.push(sendTemplateEmail("ratecon-signed", "admin@clearwatercargo.com", { templateData: brokerData, idempotencyKey: `ratecon-signed-admin-${req.id}` }));
    }
    const results = await Promise.allSettled(jobs);
    results.forEach((r) => { if (r.status === "rejected") console.error("ratecon email failed", r.reason); });
  } catch (e) {
    console.error("ratecon emails failed", e);
  }
}

export const signRateCon = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    tokenSchema.extend({
      name: z.string().trim().min(2).max(120),
      title: z.string().trim().max(80).optional(),
      consent: z.literal(true),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, req, problem } = await loadRequest(data.token);
    if (problem || !req) return { ok: false as const, problem: problem ?? "Invalid link" };
    const rc = req.snapshot as unknown as RateConData;
    // The signed copy is built here from the saved snapshot, stamped with server time, IP and device.
    const { buildRateConPdf } = await import("./ratecon");
    const { addSignatureCertificate, sha256Hex, stableJson, ESIGN_CONSENT } = await import("./esign");
    const { requestSigner } = await import("./esign.server");
    const signedAt = new Date().toISOString();
    const { ip, ua } = requestSigner();
    const termsSha = await sha256Hex(stableJson(rc));
    const title = data.title || undefined;
    const doc = buildRateConPdf(rc, { name: data.name, title, signedAt });
    addSignatureCertificate(doc, {
      document: `Rate Confirmation RC #${rc.rc} · ${rc.lane}`,
      reference: `RC-${rc.rc}-${req.id.slice(0, 8).toUpperCase()}`,
      parties: `Clearwater Cargo LLC (broker) and ${rc.carrier}${rc.carrierMc ? ` (${rc.carrierMc})` : ""} (carrier)`,
      signer: data.name, signerTitle: title, sentTo: req.carrier_email,
      signedAt, ip, device: ua, consent: ESIGN_CONSENT, termsSha256: termsSha,
    });
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    const docSha = await sha256Hex(bytes);
    const path = `${req.load_id}/ratecon-${rc.rc}-signed-${req.id.slice(0, 8)}.pdf`;
    const { error } = await supabaseAdmin.storage
      .from("load-docs")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (error) { console.error(error); return { ok: false as const, problem: "Could not save the signed document. Please try again." }; }
    await supabaseAdmin.from("ratecon_requests").update({
      status: "signed", signer_name: data.name, signer_title: title ?? null, signed_at: signedAt, pdf_path: path,
      signer_ip: ip, user_agent: ua, consent_text: ESIGN_CONSENT, terms_sha256: termsSha, doc_sha256: docSha,
    }).eq("id", req.id);
    await supabaseAdmin.from("loads").update({ ratecon_signed: true, ratecon_pdf_path: path }).eq("id", req.load_id);
    await sendSignedEmails(supabaseAdmin, req, rc, data.name, title, signedAt);
    const { data: s } = await supabaseAdmin.storage.from("load-docs").createSignedUrl(path, 60 * 60);
    return { ok: true as const, downloadUrl: s?.signedUrl ?? null };
  });
