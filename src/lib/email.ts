export type MailClient = "gmail" | "default";
const KEY = "cw-mail-client";

export const getMailClient = (): MailClient =>
  (typeof window !== "undefined" && localStorage.getItem(KEY) === "default" ? "default" : "gmail");
export const setMailClient = (c: MailClient) => localStorage.setItem(KEY, c);

/** Opens a pre-filled email in Gmail (Google Workspace) or the computer's default mail app. */
export function composeEmail(to: string, subject: string, body: string, client: MailClient = getMailClient()) {
  if (client === "gmail") {
    const u = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(u, "_blank", "noopener");
  } else {
    window.open(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  }
}
