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
  openDraft(to, subject, body, client, cc);
  return false;
}

function openDraft(to: string, subject: string, body: string, client: MailClient, cc?: string) {
  if (client === "gmail") {
    const u = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}${cc ? `&cc=${encodeURIComponent(cc)}` : ""}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(u, "_blank", "noopener");
  } else {
    window.open(`mailto:${to}?${cc ? `cc=${encodeURIComponent(cc)}&` : ""}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  }
}

export type MailFile = { filename: string; mime: string; blob: Blob };
const toB64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Sends an email with files attached from the user's connected Gmail.
 * Without Gmail, the files download and a draft opens so they can be attached by hand.
 * Returns true when sent directly.
 */
export async function composeEmailWithFiles(to: string, subject: string, body: string, files: MailFile[], cc?: string): Promise<boolean> {
  try {
    const attachments = await Promise.all(files.map(async (f) => ({ filename: f.filename, mime: f.mime, base64: await toB64(f.blob) })));
    const r = await sendGmail({ data: { to, subject, body, attachments, ...(cc ? { cc } : {}) } });
    if (r.sent) return true;
  } catch {
    // fall back to a draft
  }
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f.blob);
    a.download = f.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  openDraft(to, subject, `${body}\n\n(Attach: ${files.map((f) => f.filename).join(", ")} — downloaded to your computer)`, getMailClient(), cc);
  return false;
}
