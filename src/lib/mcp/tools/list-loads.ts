import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const STATUSES = ["available", "vetting", "booked", "dispatched", "rolling", "delivered", "invoiced", "paid", "issue", "cancelled"] as const;

export default defineTool({
  name: "list_loads",
  title: "List loads",
  description: "List loads on the Clearwater Cargo board, newest pickup first, optionally filtered by status, text search or pickup date range.",
  inputSchema: {
    status: z.enum(STATUSES).optional().describe("Only loads with this status."),
    search: z.string().max(80).optional().describe("Match load #, customer ref #, shipper PO/PU ref #, origin or destination city."),
    pickup_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Earliest pickup date, YYYY-MM-DD."),
    pickup_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Latest pickup date, YYYY-MM-DD."),
    limit: z.number().int().min(1).max(100).optional().describe("Max loads to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, search, pickup_from, pickup_to, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not signed in.");
    const db = supabaseForUser(ctx);
    let q = db
      .from("loads")
      .select("id, load_number, status, origin_city, origin_state, dest_city, dest_state, pickup_at, delivery_at, equipment, commodity, customer_ref, ship_ref, customer_rate, carrier_rate, closed_at, customer:companies!loads_customer_id_fkey(name), carrier:carriers!loads_carrier_id_fkey(legal_name)")
      .order("pickup_at", { ascending: false, nullsFirst: false })
      .limit(limit ?? 25);
    if (status) q = q.eq("status", status);
    if (pickup_from) q = q.gte("pickup_at", `${pickup_from}T00:00:00`);
    if (pickup_to) q = q.lte("pickup_at", `${pickup_to}T23:59:59`);
    const term = search?.replace(/[,()*%]/g, " ").trim();
    if (term) {
      const p = `%${term}%`;
      q = q.or(`load_number.ilike.${p},customer_ref.ilike.${p},ship_ref.ilike.${p},origin_city.ilike.${p},dest_city.ilike.${p}`);
    }
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const loads = (data ?? []).map((l) => ({
      id: l.id,
      load_number: l.load_number,
      status: l.status,
      closed_out: !!l.closed_at,
      origin: [l.origin_city, l.origin_state].filter(Boolean).join(", "),
      destination: [l.dest_city, l.dest_state].filter(Boolean).join(", "),
      pickup_at: l.pickup_at,
      delivery_at: l.delivery_at,
      equipment: l.equipment,
      commodity: l.commodity,
      customer: l.customer?.name ?? null,
      carrier: l.carrier?.legal_name ?? null,
      customer_ref: l.customer_ref,
      shipper_po_ref: l.ship_ref,
      customer_rate: l.customer_rate,
      carrier_rate: l.carrier_rate,
    }));
    const text = loads.length
      ? loads.map((l) => `${l.load_number} [${l.status}] ${l.origin} → ${l.destination} · pickup ${l.pickup_at?.slice(0, 10) ?? "—"} · ${l.customer ?? "no customer"} / ${l.carrier ?? "no carrier"} (id ${l.id})`).join("\n")
      : "No loads match.";
    return { content: [{ type: "text", text }], structuredContent: { loads } };
  },
});
