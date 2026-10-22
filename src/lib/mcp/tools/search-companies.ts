import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_companies",
  title: "Search customers & facilities",
  description: "Find customers, shippers and consignees in the directory by name or city.",
  inputSchema: {
    query: z.string().min(1).max(80).describe("Company name or city."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not signed in.");
    const db = supabaseForUser(ctx);
    const term = query.replace(/[,()*%]/g, " ").trim();
    if (!term) throw new ToolError("Search text is required.");
    const p = `%${term}%`;
    const { data, error } = await db
      .from("companies")
      .select("id, name, kind, contact_name, phone, email, address, city, state, zip, pay_terms")
      .or(`name.ilike.${p},city.ilike.${p}`)
      .order("name")
      .limit(25);
    if (error) throw new ToolError(error.message);
    const companies = (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      contact_name: c.contact_name,
      phone: c.phone,
      email: c.email,
      address: [c.address, c.city, c.state, c.zip].filter(Boolean).join(", "),
      pay_terms: c.pay_terms,
    }));
    const text = companies.length
      ? companies.map((c) => `${c.name} (${c.kind}) ${c.address} · ${c.phone ?? "no phone"}`).join("\n")
      : "No companies match.";
    return { content: [{ type: "text", text }], structuredContent: { companies } };
  },
});
