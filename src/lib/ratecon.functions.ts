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

export const getRateConForSigning = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { req, problem } = await loadRequest(data.token);
    if (problem || !req) return { ok: false as const, problem: problem ?? "Invalid link" };
    return { ok: true as const, rc: req.snapshot as unknown as RateConData };
  });

export const signRateCon = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    tokenSchema.extend({
      name: z.string().trim().min(2).max(120),
      title: z.string().trim().max(80).optional(),
      signedAt: z.string().datetime(),
      pdfBase64: z.string().min(100).max(8_000_000),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, req, problem } = await loadRequest(data.token);
    if (problem || !req) return { ok: false as const, problem: problem ?? "Invalid link" };
    const rc = req.snapshot as unknown as RateConData;
    const path = `${req.load_id}/ratecon-${rc.rc}-signed.pdf`;
    const { error } = await supabaseAdmin.storage
      .from("load-docs")
      .upload(path, Buffer.from(data.pdfBase64, "base64"), { contentType: "application/pdf", upsert: true });
    if (error) { console.error(error); return { ok: false as const, problem: "Could not save the signed document. Please try again." }; }
    await supabaseAdmin.from("ratecon_requests").update({
      status: "signed", signer_name: data.name, signer_title: data.title || null, signed_at: data.signedAt, pdf_path: path,
    }).eq("id", req.id);
    await supabaseAdmin.from("loads").update({ ratecon_signed: true, ratecon_pdf_path: path }).eq("id", req.load_id);
    return { ok: true as const };
  });
