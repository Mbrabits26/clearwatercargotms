// Server-only: reads each sender's Gmail for shipper replies/bounces, sorts them with AI and updates the lead.
import { readDocJson } from "./extract.server";
import {
  REPLY_CATEGORIES, REPLY_CHECK_MIN, REPLY_LABEL, emailFrom, fallbackCategory, findBouncedEmail, nyClock, replyPlan, replySearches, stripQuoted,
  type ReplyCategory,
} from "./outreach";

const GW = "https://connector-gateway.lovable.dev";
const READ_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const MAX_PER_RUN = 25;

type SenderRow = { id: string; user_id: string; from_email: string; display_name: string; replies_checked_at: string | null };
type LeadRow = { id: string; email: string | null; company_name: string; outreach_status: string; do_not_contact: boolean; stage: string };
type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };
type GmailMsg = { id: string; threadId?: string; internalDate?: string; snippet?: string; payload?: Part };

export type ReplyCheckResult = { status: "ok" | "reconnect" | "not_connected" | "skipped" | "error"; found: number; notes: string[] };

const decode = (d: string) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function bodyText(p: Part | undefined): string {
  if (!p) return "";
  const walk = (x: Part, mime: string): string | null => {
    if (x.mimeType === mime && x.body?.data) return decode(x.body.data);
    for (const c of x.parts ?? []) { const r = walk(c, mime); if (r) return r; }
    return null;
  };
  const plain = walk(p, "text/plain");
  if (plain) return plain;
  const html = walk(p, "text/html");
  return html ? html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&") : "";
}
const header = (m: GmailMsg, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** Fetches full messages in Gmail batch requests (max 50 per batch). */
async function batchGet(key: string, ids: string[]) {
  const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");
  const out: GmailMsg[] = [];
  const errors: string[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const b = `batch_${crypto.randomUUID().replace(/-/g, "")}`;
    const body = chunk.map((id, n) => `--${b}\r\nContent-Type: application/http\r\nContent-ID: <m${n}>\r\n\r\nGET /gmail/v1/users/me/messages/${id}?format=full\r\n`).join("") + `--${b}--`;
    const res = await callAsAppUser({
      gatewayBaseUrl: GW, connectionAPIKey: key, connectorId: "google_mail", path: "/batch/gmail/v1", requiredScopes: READ_SCOPES,
      init: { method: "POST", headers: { "Content-Type": `multipart/mixed; boundary=${b}` }, body },
    });
    if (!res.ok) { errors.push(`Gmail batch ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
    const ct = res.headers.get("content-type") ?? "";
    const rb = ct.match(/boundary="?([^";]+)"?/i)?.[1];
    if (!/multipart\/mixed/i.test(ct) || !rb) { errors.push("Gmail batch returned an unexpected format"); continue; }
    const text = await res.text();
    for (const raw of text.split(`--${rb}`)) {
      const part = raw.trim();
      if (!part || part === "--") continue;
      const httpStart = part.search(/HTTP\/\d(\.\d)? \d{3}/);
      if (httpStart < 0) continue;
      const inner = part.slice(httpStart);
      const status = Number(inner.match(/^HTTP\/\d(?:\.\d)? (\d{3})/)?.[1] ?? 0);
      const jsonStart = inner.indexOf("{");
      if (status < 200 || status > 299) { errors.push(`Gmail message ${status}`); continue; }
      if (jsonStart < 0) continue;
      try { out.push(JSON.parse(inner.slice(jsonStart, inner.lastIndexOf("}") + 1)) as GmailMsg); } catch { errors.push("Couldn't read one Gmail message"); }
    }
  }
  return { messages: out, errors };
}

const CLASSIFY_SCHEMA = {
  type: "object", additionalProperties: false, required: ["category", "summary", "follow_up_date"],
  properties: {
    category: { type: "string", enum: REPLY_CATEGORIES.filter((c) => c !== "bounce") },
    summary: { type: "string" },
    follow_up_date: { type: ["string", "null"] },
  },
};

async function classify(subject: string, text: string, today: string): Promise<{ category: ReplyCategory; summary: string; follow_up_date: string | null }> {
  const aiKey = process.env.LOVABLE_API_KEY;
  if (aiKey) {
    try {
      const r = (await readDocJson({
        name: "reply", schema: CLASSIFY_SCHEMA,
        instructions: `You sort replies to a freight broker's cold emails (Clearwater Cargo, flatbed/step deck/van capacity). Today is ${today}.
Categories:
- hot: they have freight, want rates/a quote, send lanes, or ask to talk/call.
- info: a real reply that asks questions or wants more info but no freight yet.
- later: bad timing, "reach out next quarter/in spring", contract locked, check back later.
- not_interested: no thanks, we have carriers/brokers we use, not a fit.
- opt_out: asks to be removed, unsubscribe, stop emailing.
- auto_reply: out-of-office, vacation, automatic acknowledgement, "this mailbox is not monitored".
summary: one short line for the broker (what they said and any lanes/dates/contacts mentioned).
follow_up_date: YYYY-MM-DD only when they name a time to reach back out (category later), else null.`,
        ask: "Sort this reply.",
      }, [{ type: "input_text", text: `Subject: ${subject}\n\n${text.slice(0, 4000)}` }], aiKey)) as { category: ReplyCategory; summary: string; follow_up_date: string | null };
      if (REPLY_CATEGORIES.includes(r.category)) return r;
    } catch (e) {
      console.error("Reply classify failed:", e instanceof Error ? e.message : e);
    }
  }
  return { category: fallbackCategory(subject, text), summary: text.slice(0, 160), follow_up_date: null };
}

/** Checks one sender's inbox for replies from leads they've emailed and acts on each one. */
export async function checkRepliesForSender(snd: SenderRow, force = false): Promise<ReplyCheckResult> {
  const notes: string[] = [];
  if (!force && snd.replies_checked_at && Date.now() - new Date(snd.replies_checked_at).getTime() < REPLY_CHECK_MIN * 60_000) return { status: "skipped", found: 0, notes };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getConnectionKeyForUser } = await import("@/server/appUserConnections.server");
  const { callAsAppUser, appUserReconnectRequired } = await import("@/integrations/lovable/appUserConnector");
  const key = await getConnectionKeyForUser(snd.user_id, "google_mail");
  if (!key) return { status: "not_connected", found: 0, notes: ["Gmail not connected"] };

  const startedAt = new Date().toISOString();
  const since = new Date(Date.now() - 45 * 86400_000).toISOString();
  const { data: sentRows, error: sErr } = await supabaseAdmin.from("outreach_messages")
    .select("sent_at, leads!inner(id, email, company_name, outreach_status, do_not_contact, stage)")
    .eq("sender_id", snd.id).eq("status", "sent").gte("sent_at", since).order("sent_at").limit(1000);
  if (sErr) return { status: "error", found: 0, notes: [sErr.message] };
  const byEmail = new Map<string, LeadRow>();
  let firstSent: string | null = null;
  for (const r of (sentRows ?? []) as unknown as { sent_at: string; leads: LeadRow }[]) {
    const l = r.leads;
    if (!l.email || l.do_not_contact || !["active", "done"].includes(l.outreach_status)) continue;
    byEmail.set(l.email.trim().toLowerCase(), l);
    if (!firstSent || r.sent_at < firstSent) firstSent = r.sent_at;
  }
  const done = async (status: ReplyCheckResult["status"], found: number, readOk = true) => {
    await supabaseAdmin.from("outreach_senders").update({ replies_checked_at: startedAt, ...(readOk ? { reply_access: "on" } : {}) }).eq("id", snd.id);
    return { status, found, notes };
  };
  if (!byEmail.size || !firstSent) return done("ok", 0, false);

  const lastCheck = snd.replies_checked_at ? new Date(snd.replies_checked_at).getTime() - 2 * 3600_000 : 0;
  const afterSec = Math.floor(Math.max(new Date(firstSent).getTime() - 3600_000, lastCheck) / 1000);
  const emails = [...byEmail.keys()];
  const searches = [...replySearches(emails, afterSec), `from:(mailer-daemon OR postmaster) after:${afterSec}`];
  const ids = new Set<string>();
  for (const q of searches) {
    const res = await callAsAppUser({
      gatewayBaseUrl: GW, connectionAPIKey: key, connectorId: "google_mail",
      path: `/gmail/v1/users/me/messages?maxResults=50&q=${encodeURIComponent(q)}`, requiredScopes: READ_SCOPES,
    });
    if (await appUserReconnectRequired(res)) {
      await supabaseAdmin.from("outreach_senders").update({ reply_access: "reconnect" }).eq("id", snd.id);
      return { status: "reconnect", found: 0, notes: ["Reconnect Gmail to let the TMS read replies"] };
    }
    if (!res.ok) {
      const t = await res.text();
      console.error(`Gmail search failed [${res.status}]: ${t}`);
      if (res.status === 403 && /insufficient/i.test(t)) {
        await supabaseAdmin.from("outreach_senders").update({ reply_access: "reconnect" }).eq("id", snd.id);
        return { status: "reconnect", found: 0, notes: ["Reconnect Gmail to let the TMS read replies"] };
      }
      return { status: "error", found: 0, notes: [`Gmail search failed (${res.status})`] };
    }
    const j = (await res.json()) as { messages?: { id: string }[] };
    for (const m of j.messages ?? []) ids.add(m.id);
  }
  if (!ids.size) return done("ok", 0);

  const { data: seen } = await supabaseAdmin.from("outreach_replies").select("gmail_message_id").eq("sender_id", snd.id).in("gmail_message_id", [...ids]);
  const seenSet = new Set((seen ?? []).map((x) => x.gmail_message_id));
  const fresh = [...ids].filter((id) => !seenSet.has(id)).slice(0, MAX_PER_RUN);
  if (!fresh.length) return done("ok", 0);

  const { messages, errors } = await batchGet(key, fresh);
  notes.push(...errors);
  messages.sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  const today = nyClock(new Date()).date;
  const handled = new Set<string>();
  let found = 0;
  for (const m of messages) {
    const from = emailFrom(header(m, "From"));
    const subject = header(m, "Subject");
    const full = bodyText(m.payload) || m.snippet || "";
    const isBounce = /mailer-daemon|postmaster/i.test(from);
    let lead: LeadRow | undefined;
    let category: ReplyCategory;
    let summary: string;
    let followUp: string | null = null;
    const text = isBounce ? full : stripQuoted(full);
    if (isBounce) {
      const bad = findBouncedEmail(full, emails);
      if (!bad) continue;
      lead = byEmail.get(bad);
      category = "bounce";
      summary = `Email to ${bad} bounced`;
    } else {
      if (from === snd.from_email.toLowerCase()) continue;
      lead = byEmail.get(from);
      if (!lead) continue;
      const c = await classify(subject, text, today);
      category = c.category; summary = c.summary; followUp = c.follow_up_date;
    }
    if (!lead) continue;
    const already = handled.has(lead.id);
    const plan = replyPlan(category, { stage: lead.stage, today, followUp });
    const receivedAt = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : startedAt;
    const { data: ins } = await supabaseAdmin.from("outreach_replies").upsert({
      lead_id: lead.id, sender_id: snd.id, gmail_message_id: m.id, thread_id: m.threadId ?? null, from_email: from,
      subject: subject.slice(0, 500), body: text.slice(0, 4000), category, summary: summary.slice(0, 500),
      action_taken: already ? "Lead already handled this run" : plan.action, received_at: receivedAt,
    }, { onConflict: "sender_id,gmail_message_id", ignoreDuplicates: true }).select("id");
    if (!ins?.length) continue; // another check already took this message
    found++;
    if (already || category === "auto_reply") continue;
    handled.add(lead.id);
    if (plan.stop) await supabaseAdmin.from("outreach_messages").update({ status: "skipped", error: `Stopped: ${REPLY_LABEL[category]}` }).eq("lead_id", lead.id).eq("status", "pending");
    if (plan.lead) await supabaseAdmin.from("leads").update(plan.lead).eq("id", lead.id);
    await supabaseAdmin.from("lead_activities").insert({
      lead_id: lead.id, method: "email", author_id: snd.user_id, occurred_at: receivedAt,
      follow_up: plan.lead && "next_follow_up" in plan.lead ? plan.lead.next_follow_up : null,
      notes: `${REPLY_LABEL[category]} (read automatically from ${snd.from_email}): ${summary}`.slice(0, 2000),
    });
    if (plan.alert) {
      const icon = category === "hot" ? "🔥" : category === "later" ? "🕒" : "💬";
      await supabaseAdmin.from("chat_messages").insert({ channel: "team", author_id: snd.user_id, body: `${icon} Shipper reply — ${lead.company_name} (${REPLY_LABEL[category]}) to ${snd.display_name}: ${summary}`.slice(0, 1000) });
    }
    notes.push(`${lead.company_name}: ${REPLY_LABEL[category]}`);
  }
  return done("ok", found);
}

/** Cron entry: checks every active sender (each at most every REPLY_CHECK_MIN minutes). */
export async function checkAllReplies() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: senders } = await supabaseAdmin.from("outreach_senders").select("id, user_id, from_email, display_name, replies_checked_at, reply_access").eq("active", true);
  const report: string[] = [];
  for (const s of senders ?? []) {
    if (s.reply_access === "reconnect") continue; // waits until they reconnect Gmail
    try {
      const r = await checkRepliesForSender(s as SenderRow);
      if (r.status !== "skipped") report.push(`${s.from_email}: ${r.status}, ${r.found} new${r.notes.length ? ` — ${r.notes.join("; ")}` : ""}`);
    } catch (e) {
      report.push(`${s.from_email}: error ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}
