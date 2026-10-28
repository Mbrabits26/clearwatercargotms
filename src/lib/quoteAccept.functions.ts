import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenSchema = z.object({ token: z.string().uuid() });

async function loadQuote(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: q } = await supabaseAdmin.from("quotes").select("*").eq("accept_token", token).maybeSingle();
  return { supabaseAdmin, q };
}

/** Public: shipper views their quote via its accept link (token-validated). */
export const getQuoteForCustomer = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { q } = await loadQuote(data.token);
    if (!q) return { ok: false as const, problem: "This quote link is not valid." };
    return {
      ok: true as const,
      quote: {
        quote_number: q.quote_number, kind: q.kind, customer_name: q.customer_name,
        origin: `${q.origin_city}, ${q.origin_state}`, dest: `${q.dest_city}, ${q.dest_state}`,
        equipment: q.equipment, miles: q.miles, pickup_date: q.pickup_date, rate: Number(q.rate),
        accessorials: (q.accessorials as { type: string; amount: number }[] | null) ?? [],
        notes: q.notes, status: q.status, expires_at: q.expires_at, responded_at: q.responded_at,
        expired: new Date(q.expires_at).getTime() < Date.now(),
      },
    };
  });

/** Public: shipper accepts or declines. Accepting marks the quote won and puts a load on the Dispatch board. */
export const respondQuote = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      token: z.string().uuid(),
      action: z.enum(["accept", "decline"]),
      name: z.string().trim().min(1).max(120),
      note: z.string().trim().max(1000).nullable(),
    }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, q } = await loadQuote(data.token);
    if (!q) throw new Error("This quote link is not valid.");
    if (q.status === "won" || q.status === "lost") throw new Error("This quote has already been answered. Call 252-497-7916 with changes.");
    if (new Date(q.expires_at).getTime() < Date.now()) throw new Error("This quote has expired. Call 252-497-7916 for a fresh rate.");
    let load_id = q.load_id;
    let loadNo: string | null = null;
    if (data.action === "accept" && !load_id) {
      const { data: l, error } = await supabaseAdmin.from("loads").insert({
        customer_id: q.customer_id, broker_id: q.broker_id, origin_city: q.origin_city, origin_state: q.origin_state,
        dest_city: q.dest_city, dest_state: q.dest_state, equipment: q.equipment, miles: q.miles,
        customer_rate: q.rate, carrier_rate: q.target_carrier_rate ?? 0, accessorials: q.accessorials,
        pickup_at: q.pickup_date ? `${q.pickup_date}T08:00` : null,
        customer_ref: q.quote_number,
      }).select("id, load_number").single();
      if (error) throw new Error("Could not book this quote. Please call 252-497-7916.");
      load_id = l.id; loadNo = l.load_number;
    }
    await supabaseAdmin.from("quotes").update({
      status: data.action === "accept" ? "won" : "lost",
      lost_reason: data.action === "decline" ? `Declined by customer${data.note ? `: ${data.note}` : ""}` : q.lost_reason,
      load_id, responded_at: new Date().toISOString(), accepted_by: data.name, customer_note: data.note,
    }).eq("id", q.id);
    if (q.broker_id) {
      const lane = `${q.origin_city}, ${q.origin_state} → ${q.dest_city}, ${q.dest_state}`;
      const body = data.action === "accept"
        ? `✅ Quote ${q.quote_number} (${lane}) ACCEPTED online by ${data.name} for ${q.customer_name ?? "customer"}. Load ${loadNo ?? ""} is on the Dispatch board — needs a carrier.`
        : `❌ Quote ${q.quote_number} (${lane}) declined online by ${data.name}${data.note ? `: "${data.note}"` : ""}.`;
      await supabaseAdmin.from("chat_messages").insert({ channel: "team", author_id: q.broker_id, body });
    }
    return { ok: true };
  });
