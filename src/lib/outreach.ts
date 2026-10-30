// Shared (browser-safe) outreach rules: sending window, spacing and cadence.

/** Days after enrollment each touch may go out (touch 1, 2, 3). */
export const CADENCE_DAYS = [0, 3, 8] as const;
/** Hard ceiling on cold emails per sender per day, whatever the sender setting says. */
export const MAX_DAILY_CAP = 40;
/** Minimum minutes between two cold emails from the same sender. */
export const MIN_GAP_MIN = 5;

export const INDUSTRIES = ["Lumber & timber", "Steel & metal fabrication", "Building materials", "Machinery & equipment", "Packaging & paper", "Food & agriculture", "Plastics & chemicals", "Furniture", "Other manufacturing"];
export const EQUIPMENT = ["Flatbed", "Step Deck", "Conestoga", "Dry Van", "Reefer"];

/** Hour/minute/weekday in New York time. */
export function nyClock(d: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: parts.weekday as string, date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Cold email only goes out Mon–Fri, 8:00 AM to 4:30 PM Eastern. */
export function inSendWindow(d: Date) {
  const c = nyClock(d);
  if (c.weekday === "Sat" || c.weekday === "Sun") return false;
  const m = c.hour * 60 + c.minute;
  return m >= 8 * 60 && m < 16 * 60 + 30;
}

/** Whether a sender may send one more email now. */
export function senderCanSend(s: { daily_cap: number; last_sent_at: string | null }, sentToday: number, now: Date) {
  if (!inSendWindow(now)) return false;
  if (sentToday >= Math.min(s.daily_cap, MAX_DAILY_CAP)) return false;
  if (s.last_sent_at && now.getTime() - new Date(s.last_sent_at).getTime() < MIN_GAP_MIN * 60_000) return false;
  return true;
}

/** Any of these words in a reply means stop and never contact again. */
export function isOptOut(text: string) {
  return /\b(unsubscribe|remove me|stop|pass|not interested|do not contact|take me off)\b/i.test(text);
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- Automatic reply reading ----------

/** What a shipper's reply means. bounce = the address doesn't exist. */
export const REPLY_CATEGORIES = ["hot", "info", "later", "not_interested", "opt_out", "auto_reply", "bounce"] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

export const REPLY_LABEL: Record<ReplyCategory, string> = {
  hot: "Hot — wants a quote", info: "Has questions", later: "Reach out later", not_interested: "Not interested",
  opt_out: "Asked to be removed", auto_reply: "Out-of-office / auto reply", bounce: "Bounced — bad address",
};

/** Minutes between automatic reply checks for one sender. */
export const REPLY_CHECK_MIN = 15;

/** "Jane Doe <Jane@Acme.com>" → "jane@acme.com" */
export function emailFrom(header: string | null | undefined) {
  const h = header ?? "";
  const m = h.match(/<([^>]+)>/) ?? h.match(/([^\s<>"]+@[^\s<>"]+)/);
  return (m?.[1] ?? "").trim().toLowerCase();
}

/** Drops quoted history ("On … wrote:" and "> " lines) so only their new words remain. */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^From: .+/i.test(l.trim()) && out.length > 0) break;
    if (l.trim().startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Used only when the AI reader is unavailable. */
export function fallbackCategory(subject: string, text: string): ReplyCategory {
  if (/\b(automatic reply|auto(-|\s)?reply|out of (the )?office|ooo)\b/i.test(`${subject} ${text.slice(0, 300)}`)) return "auto_reply";
  if (/\b(unsubscribe|remove me|do not contact|take me off)\b/i.test(text)) return "opt_out";
  if (/\bnot interested\b/i.test(text)) return "not_interested";
  return "info";
}

/** Finds which lead address a bounce message is about. */
export function findBouncedEmail(text: string, emails: string[]) {
  const t = text.toLowerCase();
  return emails.find((e) => t.includes(e)) ?? null;
}

/** Gmail search strings for replies from these addresses, a few addresses per search. */
export function replySearches(emails: string[], afterSec: number, per = 15) {
  const out: string[] = [];
  for (let i = 0; i < emails.length; i += per) out.push(`from:(${emails.slice(i, i + per).join(" OR ")}) -in:sent -in:chats after:${afterSec}`);
  return out;
}

/** What the TMS does to the lead for each kind of reply. */
export function replyPlan(cat: ReplyCategory, o: { stage: string; today: string; followUp?: string | null }) {
  switch (cat) {
    case "auto_reply":
      return { stop: false, alert: false, lead: null, action: "Ignored auto reply — follow-ups continue" };
    case "hot":
      return { stop: true, alert: true, lead: { outreach_status: "replied", stage: "quoting", next_follow_up: o.today }, action: "Follow-ups stopped, moved to Quoting, team notified" };
    case "info":
      return { stop: true, alert: true, lead: { outreach_status: "replied", stage: o.stage === "new" ? "contacted" : o.stage, next_follow_up: o.today }, action: "Follow-ups stopped, follow up today, team notified" };
    case "later": {
      const fu = o.followUp && /^\d{4}-\d{2}-\d{2}$/.test(o.followUp) && o.followUp > o.today ? o.followUp : addDays(o.today, 45);
      return { stop: true, alert: true, lead: { outreach_status: "replied", stage: o.stage === "new" ? "contacted" : o.stage, next_follow_up: fu }, action: `Follow-ups stopped, reminder set for ${fu}` };
    }
    case "not_interested":
      return { stop: true, alert: false, lead: { outreach_status: "stopped", do_not_contact: true, stage: "lost", lost_reason: "Not interested (email reply)" }, action: "Follow-ups stopped, marked do-not-contact" };
    case "opt_out":
      return { stop: true, alert: false, lead: { outreach_status: "stopped", do_not_contact: true, stage: "lost", lost_reason: "Opted out of email" }, action: "Follow-ups stopped, marked do-not-contact" };
    case "bounce":
      return { stop: true, alert: false, lead: { outreach_status: "stopped" }, action: "Email bounced — follow-ups stopped; fix the address to restart" };
  }
}
