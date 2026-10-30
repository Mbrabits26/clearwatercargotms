import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CADENCE_DAYS, addDays, nyClock } from "./outreach";
import type { Prospect } from "./outreach.server";

export type { Prospect };

/** Searches the web for shipper companies matching the filters (staff only). Nothing is saved. */
export const findShipperProspects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ industry: z.string().min(2).max(80), equipment: z.string().min(2).max(40), area: z.string().min(2).max(120), count: z.number().int().min(1).max(25) }).parse(d))
  .handler(async ({ data, context }): Promise<{ prospects: Prospect[]; error: string | null }> => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const fc = process.env["FIRECRAWL_API_KEY"], ai = process.env["LOVABLE_API_KEY"];
    if (!fc || !ai) return { prospects: [], error: "Web search isn't connected." };
    try {
      const { findProspects } = await import("./outreach.server");
      return { prospects: await findProspects(data, fc, ai), error: null };
    } catch (e) {
      return { prospects: [], error: e instanceof Error ? e.message : "Search failed" };
    }
  });

/** AI-drafts the 3-touch plain-text sequence for a lead and queues it under the caller's sender profile. */
export const enrollLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: lead } = await sb.from("leads").select("id, company_name, contact_name, contact_title, city, state, industry, equipment, lanes, email, do_not_contact").eq("id", data.leadId).maybeSingle();
    if (!lead) throw new Error("Lead not found");
    if (lead.do_not_contact) throw new Error(`${lead.company_name} is marked do-not-contact.`);
    if (!lead.email) throw new Error(`${lead.company_name} has no email address.`);
    const { data: sender } = await sb.from("outreach_senders").select("*").eq("user_id", context.userId).maybeSingle();
    if (!sender) throw new Error("Set up your sender profile first (Outreach settings).");
    const ai = process.env["LOVABLE_API_KEY"];
    if (!ai) throw new Error("AI isn't configured.");
    const { draftSequence } = await import("./outreach.server");
    const { do_not_contact: _d, email: _e, ...facts } = lead;
    const emails = await draftSequence(facts, sender, ai);
    await sb.from("outreach_messages").delete().eq("lead_id", lead.id).eq("status", "pending");
    const today = nyClock(new Date()).date;
    const { error } = await sb.from("outreach_messages").insert(emails.map((e, i) => ({ lead_id: lead.id, sender_id: sender.id, step: i + 1, subject: e.subject, body: e.body, send_after: addDays(today, CADENCE_DAYS[i] ?? 0), approved: !sender.require_approval })));
    if (error) throw new Error(error.message);
    await sb.from("leads").update({ outreach_status: "active" }).eq("id", lead.id);
    return { ok: true };
  });
