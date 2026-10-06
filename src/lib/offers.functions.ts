import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenSchema = z.object({ token: z.string().uuid() });

async function loadOffer(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: offer } = await supabaseAdmin.from("load_offers").select("*").eq("token", token).maybeSingle();
  return { supabaseAdmin, offer };
}

export const getOffer = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, offer } = await loadOffer(data.token);
    if (!offer) return { ok: false as const, problem: "This load offer link is not valid." };
    const [{ data: load }, { data: carrier }] = await Promise.all([
      supabaseAdmin.from("loads").select("load_number,status,carrier_id,origin_city,origin_state,dest_city,dest_state,pickup_at,delivery_at,equipment,commodity,weight_lbs,pieces,temperature,miles").eq("id", offer.load_id).single(),
      supabaseAdmin.from("carriers").select("legal_name").eq("id", offer.carrier_id).single(),
    ]);
    if (!load) return { ok: false as const, problem: "This load is no longer available." };
    const covered = !!load.carrier_id && load.carrier_id !== offer.carrier_id;
    const { carrier_id: _c, ...pub } = load;
    return {
      ok: true as const,
      carrier: carrier?.legal_name ?? "",
      load: pub,
      covered,
      offer: { offered_rate: Number(offer.offered_rate), status: offer.status, counter_rate: offer.counter_rate, note: offer.note },
    };
  });

export const respondOffer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    tokenSchema.extend({
      action: z.enum(["accepted", "rejected", "countered"]),
      counter_rate: z.number().min(0).max(1_000_000).nullable(),
      note: z.string().trim().max(1000).nullable(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, offer } = await loadOffer(data.token);
    if (!offer) throw new Error("This load offer link is not valid.");
    const { data: load } = await supabaseAdmin.from("loads").select("carrier_id").eq("id", offer.load_id).single();
    if (load?.carrier_id && load.carrier_id !== offer.carrier_id) throw new Error("This load has already been covered. Thank you!");
    if (data.action === "countered" && !data.counter_rate) throw new Error("Enter your counter rate.");
    await supabaseAdmin.from("load_offers").update({
      status: data.action,
      counter_rate: data.action === "countered" ? data.counter_rate : null,
      note: data.note || null,
      responded_at: new Date().toISOString(),
    }).eq("id", offer.id);
    return { ok: true };
  });
