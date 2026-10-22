import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_load",
  title: "Get load details",
  description: "Get full details for one load by its load number (e.g. the RC #) or its id from list_loads.",
  inputSchema: {
    load: z.string().min(1).max(80).describe("Load number or load id."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ load }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not signed in.");
    const db = supabaseForUser(ctx);
    const isId = /^[0-9a-f-]{36}$/i.test(load.trim());
    const { data: l, error } = await db
      .from("loads")
      .select("id, load_number, status, origin_city, origin_state, dest_city, dest_state, pickup_at, delivery_at, pickup_notes, delivery_notes, equipment, commodity, weight_lbs, pieces, temperature, miles, customer_ref, ship_ref, dest_ref, customer_rate, carrier_rate, pay_terms, pod_received, ratecon_signed, last_check_call, closed_at, cancel_reason, customer:companies!loads_customer_id_fkey(name), shipper:companies!loads_shipper_id_fkey(name), consignee:companies!loads_consignee_id_fkey(name), carrier:carriers!loads_carrier_id_fkey(legal_name, mc_number, phone)")
      .eq(isId ? "id" : "load_number", load.trim())
      .maybeSingle();
    if (error) throw new ToolError(error.message);
    if (!l) throw new ToolError(`No load found for "${load}".`);
    const detail = {
      id: l.id,
      load_number: l.load_number,
      status: l.status,
      closed_out: !!l.closed_at,
      cancel_reason: l.cancel_reason,
      origin: [l.origin_city, l.origin_state].filter(Boolean).join(", "),
      destination: [l.dest_city, l.dest_state].filter(Boolean).join(", "),
      pickup_at: l.pickup_at,
      delivery_at: l.delivery_at,
      pickup_notes: l.pickup_notes,
      delivery_notes: l.delivery_notes,
      equipment: l.equipment,
      commodity: l.commodity,
      weight_lbs: l.weight_lbs,
      pieces: l.pieces,
      temperature: l.temperature,
      miles: l.miles,
      customer: l.customer?.name ?? null,
      shipper: l.shipper?.name ?? null,
      consignee: l.consignee?.name ?? null,
      carrier: l.carrier ? { name: l.carrier.legal_name, mc_number: l.carrier.mc_number, phone: l.carrier.phone } : null,
      customer_ref: l.customer_ref,
      shipper_po_ref: l.ship_ref,
      consignee_ref: l.dest_ref,
      customer_rate: l.customer_rate,
      carrier_rate: l.carrier_rate,
      pay_terms: l.pay_terms,
      pod_received: l.pod_received,
      ratecon_signed: l.ratecon_signed,
      last_check_call: l.last_check_call,
    };
    return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }], structuredContent: { load: detail } };
  },
});
