import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mergeFill } from "./carrierMerge";
import { PACKET_FIELDS, PACKET_PROMPT, type PacketData } from "./extract.functions";

const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "") || null;

/** Reads a carrier's stored documents with AI + free FMCSA data, and fills only blank fields. */
export const fixCarrierWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ carrierId: z.string().uuid(), apply: z.boolean(), patch: z.record(z.string(), z.unknown()).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const { data: c, error } = await context.supabase.from("carriers").select("*").eq("id", data.carrierId).single();
    if (error || !c) throw new Error("Carrier not found");
    if (data.apply) {
      const allowed = mergeFill(c as Record<string, unknown>, data.patch ?? {});
      if (Object.keys(allowed).length) {
        const { error: e } = await context.supabase.from("carriers").update(allowed as never).eq("id", c.id);
        if (e) throw new Error(e.message);
      }
      return { patch: allowed, notes: [] as string[] };
    }
    const notes: string[] = [];
    const incoming: Record<string, unknown> = {};
    const { data: docs } = await context.supabase.from("carrier_documents").select("kind, file_path, file_name").eq("carrier_id", c.id);
    const files = (docs ?? []).filter((d) => /\.(pdf|png|jpe?g|webp)$/i.test(d.file_name ?? d.file_path)).slice(0, 8);
    const key = process.env["LOVABLE_API_KEY"];
    if (files.length && key) {
      const parts: Record<string, unknown>[] = [];
      for (const f of files) {
        const { data: blob } = await context.supabase.storage.from("carrier-docs").download(f.file_path);
        if (!blob || blob.size > 9_000_000) continue;
        const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
        const name = f.file_name ?? f.file_path;
        if (/\.pdf$/i.test(name)) parts.push({ type: "input_file", filename: name, file_data: `data:application/pdf;base64,${b64}` });
        else parts.push({ type: "input_image", image_url: `data:${blob.type || "image/jpeg"};base64,${b64}` });
      }
      if (parts.length) {
        const { readDocJson } = await import("./extract.server");
        const p = (await readDocJson({
          instructions: PACKET_PROMPT, ask: "Extract the carrier details from these documents.", name: "packet",
          schema: { type: "object", additionalProperties: false, required: Object.keys(PACKET_FIELDS), properties: PACKET_FIELDS },
        }, parts, key)) as PacketData;
        Object.assign(incoming, {
          dba: p.dba, mc_number: digits(p.mc_number), dot_number: digits(p.dot_number), address: p.address, city: p.city, state: p.state, zip: p.zip,
          phone: p.phone, email: p.email, contact_name: p.contact_name, equipment: p.equipment,
          auto_liability: p.auto_liability, insurance_expires: p.insurance_expires, cargo_insurance: p.cargo_insurance, cargo_expires: p.cargo_expires,
          factoring_company: p.factoring_company, factoring_remit: p.factoring_remit,
          w9_received: p.has_w9 || undefined, coi_received: p.has_coi || undefined, agreement_signed: p.has_agreement_signed || undefined,
          noa_received: p.has_noa || undefined, voided_check_received: p.has_voided_check || undefined,
        });
        if (p.factoring_company && c.pay_terms === "net30") incoming.pay_terms_suggest = "factoring";
      }
    } else if (!files.length) notes.push("No documents on file — ask the carrier to upload them.");
    const mc = digits(c.mc_number ?? (incoming.mc_number as string)), dot = digits(c.dot_number ?? (incoming.dot_number as string));
    if (mc || dot) {
      try {
        const { lookupCarrierFull } = await import("./fmcsa.server");
        const f = await lookupCarrierFull(mc, dot, process.env["FMCSA_WEBKEY"]);
        if (f.source !== "blocked") {
          for (const [k, v] of Object.entries({ dot_number: f.dot_number, mc_number: f.mc_number, address: f.address, city: f.city, state: f.state, zip: f.zip, phone: f.phone, email: f.email, contact_name: f.contact_name }))
            if (incoming[k] == null && v) incoming[k] = v;
          if (f.authority_status !== c.authority_status) notes.push(`FMCSA shows authority ${f.authority_status} (currently ${c.authority_status}) — update with Re-check FMCSA.`);
        }
      } catch { notes.push("FMCSA lookup unavailable right now."); }
    }
    const suggestFactoring = incoming.pay_terms_suggest; delete incoming.pay_terms_suggest;
    const patch = mergeFill(c as Record<string, unknown>, incoming);
    if (suggestFactoring && patch.factoring_company) { patch.pay_terms = "factoring"; patch.noa_received = true; }
    return { patch, notes };
  });
