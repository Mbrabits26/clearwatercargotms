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
