import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractLoads } from "./extract.server";

const input = z.object({
  fileName: z.string().max(200),
  mime: z.string().max(100),
  base64: z.string().max(14_000_000).nullable(),
  text: z.string().max(200_000).nullable(),
});

export const extractLoadFromDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Document reader is not configured.");
    const parts: Record<string, unknown>[] = [];
    if (data.text) parts.push({ type: "input_text", text: `File: ${data.fileName}\n\n${data.text}` });
    else if (data.base64 && data.mime === "application/pdf")
      parts.push({ type: "input_file", filename: data.fileName, file_data: `data:application/pdf;base64,${data.base64}` });
    else if (data.base64 && data.mime.startsWith("image/"))
      parts.push({ type: "input_image", image_url: `data:${data.mime};base64,${data.base64}` });
    else throw new Error("Upload a PDF, image, Excel or CSV file.");
    return { loads: await extractLoads(parts, key) };
  });

const PACKET_FIELDS = {
  legal_name: { type: ["string", "null"] }, dba: { type: ["string", "null"] },
  mc_number: { type: ["string", "null"] }, dot_number: { type: ["string", "null"] },
  address: { type: ["string", "null"] }, city: { type: ["string", "null"] }, state: { type: ["string", "null"] }, zip: { type: ["string", "null"] },
  phone: { type: ["string", "null"] }, email: { type: ["string", "null"] }, contact_name: { type: ["string", "null"] },
  equipment: { type: ["string", "null"] },
  auto_liability: { type: ["number", "null"] }, insurance_expires: { type: ["string", "null"] },
  cargo_insurance: { type: ["number", "null"] }, cargo_expires: { type: ["string", "null"] }, insurer: { type: ["string", "null"] },
  factoring_company: { type: ["string", "null"] }, factoring_remit: { type: ["string", "null"] },
  tin_last4: { type: ["string", "null"] }, bank_name: { type: ["string", "null"] }, signer_name: { type: ["string", "null"] },
  has_w9: { type: "boolean" }, has_coi: { type: "boolean" }, has_agreement_signed: { type: "boolean" },
  has_noa: { type: "boolean" }, has_voided_check: { type: "boolean" },
} as const;
export type PacketData = {
  [K in keyof typeof PACKET_FIELDS]: (typeof PACKET_FIELDS)[K]["type"] extends "boolean" ? boolean
    : (typeof PACKET_FIELDS)[K]["type"][0] extends "number" ? number | null : string | null;
};
const PACKET_PROMPT = `You read motor-carrier onboarding packets (W-9, certificate of insurance, broker-carrier agreement, factoring notice of assignment, voided check, carrier profile) for Clearwater Cargo, a freight broker.
Return null for anything not present — never guess.
- mc_number / dot_number: digits only (strip "MC-", "USDOT").
- States 2-letter. Dates "YYYY-MM-DD".
- auto_liability: auto/automobile liability per-occurrence limit in dollars. cargo_insurance: motor truck cargo limit. Expiration dates from the COI policy rows. insurer: insurance company name.
- factoring_company and factoring_remit (full remit-to address) only from a notice of assignment/factoring letter.
- tin_last4: ONLY the last 4 digits of the EIN/SSN from the W-9 — never return the full number.
- bank_name from a voided check; never return account or routing numbers.
- signer_name: who signed the broker-carrier agreement. has_agreement_signed true only if it is signed.
- has_* flags: true when that document is included in the packet.`;

export const extractCarrierPacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Document reader is not configured.");
    const parts: Record<string, unknown>[] = [];
    if (data.base64 && data.mime === "application/pdf")
      parts.push({ type: "input_file", filename: data.fileName, file_data: `data:application/pdf;base64,${data.base64}` });
    else if (data.base64 && data.mime.startsWith("image/"))
      parts.push({ type: "input_image", image_url: `data:${data.mime};base64,${data.base64}` });
    else throw new Error("Upload the packet as a PDF or photo.");
    const { readDocJson } = await import("./extract.server");
    const out = await readDocJson({
      instructions: PACKET_PROMPT, ask: "Extract the carrier details from this packet.", name: "packet",
      schema: { type: "object", additionalProperties: false, required: Object.keys(PACKET_FIELDS), properties: PACKET_FIELDS },
    }, parts, key);
    return { packet: out as PacketData };
  });
