// Server-only: shipper prospect discovery, AI-drafted cold email, and the throttled Gmail sender.
import { readDocJson } from "./extract.server";
import { CADENCE_DAYS, nyClock, senderCanSend, addDays } from "./outreach";

export type Prospect = { company_name: string; city: string | null; state: string | null; website: string | null; industry: string; equipment: string; why: string; contact_name: string | null; contact_title: string | null; email: string | null; phone: string | null };

async function search(query: string, fcKey: string, aiKey: string) {
  const r = await fetch("https://connector-gateway.lovable.dev/firecrawl/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}`, "X-Connection-Api-Key": fcKey },
    body: JSON.stringify({ query, limit: 6, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } }),
  });
  if (r.status === 429) throw new Error("The web search is busy — wait a minute and try again.");
  if (!r.ok) throw new Error(`Web search failed (${r.status}).`);
  const j = (await r.json()) as { data?: { web?: { url: string; title?: string; markdown?: string }[] } | { url: string; title?: string; markdown?: string }[] };
  const arr = Array.isArray(j.data) ? j.data : j.data?.web ?? [];
  return arr.map((x) => ({ url: x.url, title: x.title ?? x.url, text: (x.markdown ?? "").slice(0, 5000) }));
}

const s = { type: "string" }, ns = { type: ["string", "null"] };
const PROSPECT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["prospects"],
  properties: { prospects: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["company_name", "city", "state", "website", "industry", "equipment", "why", "contact_name", "contact_title", "email", "phone"],
    properties: { company_name: s, city: ns, state: ns, website: ns, industry: s, equipment: s, why: s, contact_name: ns, contact_title: ns, email: ns, phone: ns } } } },
};

export async function findProspects(q: { industry: string; equipment: string; area: string; count: number }, fcKey: string, aiKey: string): Promise<Prospect[]> {
  const queries = [
    `${q.industry} manufacturers ${q.area}`,
    `${q.industry} plant shipping department ${q.area} contact`,
  ];
  const pages = [] as { url: string; title: string; text: string }[];
  for (const query of queries) pages.push(...(await search(query, fcKey, aiKey)));
  if (!pages.length) throw new Error("No companies were found for that search. Try a wider area.");
  const corpus = pages.map((p, i) => `### Source ${i + 1}: ${p.title}\nURL: ${p.url}\n${p.text}`).join("\n\n");
  const out = await readDocJson({
    name: "prospects", schema: PROSPECT_SCHEMA,
    instructions: `You find freight shippers for a truckload broker with its own ${q.equipment} trucks in Staley, NC.
From the provided web pages ONLY, list up to ${q.count} real companies that make or ship physical goods (${q.industry}) in or near ${q.area} and would likely ship ${q.equipment} freight.
- Skip trucking companies, brokers, directories, news sites and retailers.
- company_name, city, state (2-letter), website exactly as shown on the pages. Never invent contacts, emails or phones — use null unless the page states them.
- Prefer shipping/logistics/traffic/plant manager contacts when a page names one.
- why: one short line on what they ship.`,
    ask: "Extract the shipper prospects.",
  }, [{ type: "input_text", text: corpus }], aiKey);
  return ((out as { prospects?: Prospect[] }).prospects ?? []).slice(0, q.count);
}

const SEQ_SCHEMA = {
  type: "object", additionalProperties: false, required: ["emails"],
  properties: { emails: { type: "array", items: { type: "object", additionalProperties: false, required: ["subject", "body"], properties: { subject: s, body: s } } } },
};

export async function draftSequence(lead: Record<string, unknown>, sender: { display_name: string; title: string | null }, aiKey: string) {
  const out = await readDocJson({
    name: "sequence", schema: SEQ_SCHEMA,
    instructions: `Write exactly 3 short plain-text cold emails from ${sender.display_name}${sender.title ? `, ${sender.title}` : ""} at Clearwater Cargo, LLC (Staley, NC) to a shipper.
Clearwater runs its own trucks through Foust Farms for regional NC/Southeast freight plus a national brokerage carrier network.
Rules (these keep the email out of spam):
- 50–90 words each, sounds typed by a person, no links, no images, no ALL CAPS, no "!" , no salesy words (free, guarantee, act now, limited time, $$$).
- Email 1: friendly intro tied to what they ship and where; ask one easy question about their outbound lanes or capacity.
- Email 2 (day 3): short follow-up offering backup capacity for tight weeks or a quick spot quote.
- Email 3 (day 8): polite last check-in.
- Greeting uses the contact's first name if known, else "Hi there".
- End each body with exactly: "If you're not the right person or don't handle freight, just reply 'pass' and I won't email again."
- Do NOT write a signature; it is added after.
- Subjects: 2–6 words, lowercase-ish, no punctuation tricks.`,
    ask: `Shipper: ${JSON.stringify(lead)}`,
  }, [], aiKey);
  const emails = ((out as { emails?: { subject: string; body: string }[] }).emails ?? []).slice(0, 3);
  if (emails.length < 3) throw new Error("The AI didn't return all three emails — try again.");
  return emails;
}

export function signature(s: { display_name: string; title: string | null; phone: string | null; from_email: string; signature: string | null }) {
  if (s.signature?.trim()) return s.signature.trim();
  return [s.display_name, s.title, "Clearwater Cargo, LLC · Staley, NC", s.phone, s.from_email].filter(Boolean).join("\n");
}

/** Sends at most one due email per active sender. Called on a schedule so emails are naturally spaced out. */
export async function sendDueOutreach() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getConnectionKeyForUser } = await import("@/server/appUserConnections.server");
  const { callAsAppUser, appUserReconnectRequired } = await import("@/integrations/lovable/appUserConnector");
  const now = new Date();
  const today = nyClock(now).date;
  const dayStart = new Date(Date.now() - 20 * 3600_000).toISOString();
  const { data: senders } = await supabaseAdmin.from("outreach_senders").select("*").eq("active", true);
  const report: string[] = [];
  for (const snd of senders ?? []) {
    const { count } = await supabaseAdmin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("sender_id", snd.id).eq("status", "sent").gte("sent_at", dayStart);
    if (!senderCanSend(snd, count ?? 0, now)) continue;
    let q = supabaseAdmin.from("outreach_messages").select("*, leads!inner(id, email, outreach_status, do_not_contact, company_name)").eq("sender_id", snd.id).eq("status", "pending").lte("send_after", today).order("step").order("send_after").limit(1);
    if (snd.require_approval) q = q.eq("approved", true);
    const { data: rows } = await q;
    const m = rows?.[0] as (typeof rows extends (infer R)[] | null ? R : never) & { leads: { id: string; email: string | null; outreach_status: string; do_not_contact: boolean; company_name: string } } | undefined;
    if (!m) continue;
    const lead = m.leads;
    if (lead.do_not_contact || lead.outreach_status !== "active" || !lead.email) {
      await supabaseAdmin.from("outreach_messages").update({ status: "skipped", error: "Lead stopped or has no email" }).eq("id", m.id);
      continue;
    }
    const key = await getConnectionKeyForUser(snd.user_id, "google_mail");
    if (!key) { report.push(`${snd.from_email}: Gmail not connected`); continue; }
    const body = `${m.body}\n\n${signature(snd)}`;
    const raw = [`To: ${lead.email}`, `Subject: ${m.subject}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", body].join("\r\n");
    const encoded = Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res = await callAsAppUser({
      gatewayBaseUrl: "https://connector-gateway.lovable.dev", connectionAPIKey: key, connectorId: "google_mail",
      path: "/gmail/v1/users/me/messages/send",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.send"],
      init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw: encoded }) },
    });
    if (await appUserReconnectRequired(res)) { report.push(`${snd.from_email}: reconnect Gmail`); continue; }
    if (!res.ok) {
      await supabaseAdmin.from("outreach_messages").update({ error: `Gmail ${res.status}` }).eq("id", m.id);
      continue;
    }
    const sentAt = new Date().toISOString();
    await supabaseAdmin.from("outreach_messages").update({ status: "sent", sent_at: sentAt, error: null }).eq("id", m.id);
    await supabaseAdmin.from("outreach_senders").update({ last_sent_at: sentAt }).eq("id", snd.id);
    const { count: left } = await supabaseAdmin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("lead_id", lead.id).eq("status", "pending");
    await supabaseAdmin.from("leads").update({ ...(m.step === 1 ? { stage: "contacted" } : {}), ...(left ? {} : { outreach_status: "done" }), next_follow_up: addDays(today, 2) }).eq("id", lead.id);
    report.push(`${snd.from_email} → ${lead.company_name} (touch ${m.step})`);
  }
  return report;
}

export { CADENCE_DAYS };
