import { sendGmail } from "@/lib/gmail.functions";

export type MailClient = "gmail" | "default";
const KEY = "cw-mail-client";

export const getMailClient = (): MailClient =>
  (typeof window !== "undefined" && localStorage.getItem(KEY) === "default" ? "default" : "gmail");
export const setMailClient = (c: MailClient) => localStorage.setItem(KEY, c);

/**
 * Sends an email. If the user has connected their Gmail, it sends directly from
 * their address (a copy lands in their Sent folder). Otherwise it opens a
 * pre-filled draft in Gmail (Google Workspace) or the computer's default mail app.
 * Returns true when the email was sent directly.
 */
export async function composeEmail(to: string, subject: string, body: string, client: MailClient = getMailClient(), cc?: string): Promise<boolean> {
  try {
    const r = await sendGmail({ data: { to, subject, body, ...(cc ? { cc } : {}) } });
    if (r.sent) return true;
  } catch {
    // Not signed in or not connected — fall back to a draft.
  }
  if (client === "gmail") {
    const u = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}${cc ? `&cc=${encodeURIComponent(cc)}` : ""}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(u, "_blank", "noopener");
  } else {
    window.open(`mailto:${to}?${cc ? `cc=${encodeURIComponent(cc)}&` : ""}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  }
  return false;
}
