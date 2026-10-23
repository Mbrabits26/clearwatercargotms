import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { removalRecipient, requestsForCarrier, type RcRequestLite } from "./carrierRemoved";

/**
 * After a carrier is taken off a load: cancel any rate con links still out to
 * them and email that carrier (only if they were sent a rate con for the load).
 */
export const notifyCarrierRemoved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ loadId: z.string().uuid(), carrierId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: staff } = await sb.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const { data: load } = await sb.from("loads")
      .select("id, load_number, carrier_id, broker_id, origin_city, origin_state, dest_city, dest_state, pickup_at, ratecon_pdf_path")
      .eq("id", data.loadId).maybeSingle();
    if (!load) throw new Error("Load not found");
    if (load.carrier_id === data.carrierId) return { sent: false as const, reason: "still_assigned" as const };
    const { data: carrier } = await sb.from("carriers").select("legal_name, email, mc_number, dot_number").eq("id", data.carrierId).maybeSingle();
    if (!carrier) throw new Error("Carrier not found");
    const { data: reqs = [] } = await sb.from("ratecon_requests").select("id, status, carrier_email, created_at, snapshot, pdf_path").eq("load_id", load.id);
    const all = (reqs ?? []) as (RcRequestLite & { pdf_path: string | null })[];
    const mine = requestsForCarrier(all, carrier);

    // Their rate con no longer counts: close open links and any signed copy.
    const open = mine.filter((r) => r.status === "sent" || r.status === "signed").map((r) => r.id);
    if (open.length) {
      await sb.from("ratecon_requests").update({
        status: "void", void_reason: "Carrier removed", void_note: `${carrier.legal_name} removed from load`,
        voided_by: context.userId, voided_at: new Date().toISOString(),
      }).in("id", open);
      if (load.ratecon_pdf_path && mine.some((r) => r.pdf_path === load.ratecon_pdf_path)) {
        await sb.from("loads").update({ ratecon_signed: false, ratecon_pdf_path: null }).eq("id", load.id);
      }
    }

    const target = removalRecipient(all, carrier);
    if (!target) return { sent: false as const, reason: mine.length ? ("no_email" as const) : ("no_ratecon" as const) };

    const brokerId = load.broker_id ?? context.userId;
    const { data: broker } = await sb.from("profiles").select("full_name, email").eq("id", brokerId).maybeSingle();
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const res = await sendTemplateEmail("carrier-removed", target.to, {
      templateData: {
        rc: load.load_number,
        lane: `${load.origin_city ?? ""}, ${load.origin_state ?? ""} → ${load.dest_city ?? ""}, ${load.dest_state ?? ""}`,
        carrier: carrier.legal_name,
        pickup: load.pickup_at ? new Date(load.pickup_at).toLocaleDateString("en-US", { timeZone: "America/New_York", dateStyle: "medium" }) : undefined,
        brokerName: broker?.full_name ?? undefined,
        brokerEmail: broker?.email ?? undefined,
      },
      replyTo: broker?.email ?? "admin@clearwatercargo.com",
      idempotencyKey: `carrier-removed-${target.requestId}`,
    });
    if (!res.sent) return { sent: false as const, reason: "suppressed" as const, to: target.to };
    await sb.from("load_notes").insert({ load_id: load.id, author_id: context.userId, body: `Removal notice emailed to ${carrier.legal_name} (${target.to}).` });
    return { sent: true as const, to: target.to };
  });
