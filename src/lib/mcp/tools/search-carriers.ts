import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_carriers",
  title: "Search carriers",
  description: "Find carriers by name, DBA, MC # or DOT # and see their vetting status, authority, safety rating and insurance expiry.",
  inputSchema: {
    query: z.string().min(1).max(80).describe("Carrier name, DBA, MC # or DOT #."),
    include_inactive: z.boolean().optional().describe("Include inactive and Do Not Use carriers (default false)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, include_inactive }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not signed in.");
    const db = supabaseForUser(ctx);
    const term = query.replace(/[,()*%]/g, " ").trim();
    if (!term) throw new ToolError("Search text is required.");
    const p = `%${term}%`;
    let q = db
      .from("carriers")
      .select("id, legal_name, dba, mc_number, dot_number, status, authority_status, safety_rating, insurance_expires, contact_name, phone, email, city, state, equipment, inactive, dnu_reason")
      .or(`legal_name.ilike.${p},dba.ilike.${p},mc_number.ilike.${p},dot_number.ilike.${p}`)
      .order("legal_name")
      .limit(25);
    if (!include_inactive) q = q.eq("inactive", false).neq("status", "dnu");
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const carriers = (data ?? []).map((c) => ({
      id: c.id,
      name: c.legal_name,
      dba: c.dba,
      mc_number: c.mc_number,
      dot_number: c.dot_number,
      status: c.status,
      authority_status: c.authority_status,
      safety_rating: c.safety_rating,
      insurance_expires: c.insurance_expires,
      contact_name: c.contact_name,
      phone: c.phone,
      email: c.email,
      location: [c.city, c.state].filter(Boolean).join(", "),
      equipment: c.equipment,
      inactive: c.inactive,
      dnu_reason: c.dnu_reason,
    }));
    const text = carriers.length
      ? carriers.map((c) => `${c.name}${c.mc_number ? ` MC ${c.mc_number}` : ""} [${c.status}${c.inactive ? ", inactive" : ""}] ${c.location} · ${c.phone ?? "no phone"}`).join("\n")
      : "No carriers match.";
    return { content: [{ type: "text", text }], structuredContent: { carriers } };
  },
});
