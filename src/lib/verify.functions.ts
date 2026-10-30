import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Public: checks a file fingerprint (computed in the visitor's browser) against the signed copies we saved.
 * Returns only what is already printed on that document; the file itself is never uploaded.
 */
export const verifySignedDocument = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rc } = await supabaseAdmin
      .from("ratecon_requests").select("snapshot,signer_name,signed_at,status")
      .eq("doc_sha256", data.sha256).limit(1).maybeSingle();
    if (rc) {
      const s = (rc.snapshot ?? {}) as { rc?: string; carrier?: string; lane?: string };
      return {
        found: true as const, document: `Rate Confirmation RC #${s.rc ?? ""}`, detail: s.lane ?? "",
        party: s.carrier ?? "", signer: rc.signer_name, signedAt: rc.signed_at, voided: rc.status === "void",
      };
    }
    const { data: ag } = await supabaseAdmin
      .from("carrier_signatures").select("external_ref,signer_name,signed_at,carriers(legal_name)")
      .eq("doc_sha256", data.sha256).limit(1).maybeSingle();
    if (ag) {
      const c = ag.carriers as { legal_name?: string } | null;
      return {
        found: true as const, document: "Broker-Carrier Agreement", detail: ag.external_ref,
        party: c?.legal_name ?? "", signer: ag.signer_name, signedAt: ag.signed_at, voided: false,
      };
    }
    return { found: false as const };
  });
