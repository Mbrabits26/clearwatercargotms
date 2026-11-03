// Carrier identity checks: compare the contact a broker is actually dealing with
// against what FMCSA has on file, catching lookalike ("one letter off") domains.

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "proton.me", "protonmail.com", "live.com", "msn.com", "mail.com", "gmx.com", "yandex.com", "zoho.com"]);

export const emailDomain = (e: string | null | undefined) => {
  const m = (e ?? "").trim().toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m ? m[1] : null;
};
const digits = (p: string | null | undefined) => { const d = (p ?? "").replace(/\D/g, ""); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; };
/** Domain name without TLD and punctuation, e.g. "abc-trucking.net" → "abctrucking". */
const core = (d: string) => d.replace(/\.[a-z]{2,}(\.[a-z]{2})?$/, "").replace(/[^a-z0-9]/g, "");

export function editDistance(a: string, b: string) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export type FraudFlag = { level: "high" | "medium" | "ok"; text: string };

export function contactRisk(contact: { email?: string | null; phone?: string | null }, fmcsa: { email?: string | null; phone?: string | null; cell_phone?: string | null }): FraudFlag[] {
  const out: FraudFlag[] = [];
  const cd = emailDomain(contact.email), fd = emailDomain(fmcsa.email);
  if (cd) {
    if (fd && cd === fd) out.push({ level: "ok", text: `Email domain matches FMCSA (${fd})` });
    else if (fd && !FREE_MAIL.has(fd) && (core(cd) === core(fd) || editDistance(core(cd), core(fd)) <= 2))
      out.push({ level: "high", text: `Lookalike domain: ${cd} vs FMCSA ${fd} — classic carrier identity theft` });
    else if (fd && cd !== fd && !FREE_MAIL.has(cd)) out.push({ level: "high", text: `Email domain ${cd} is not the FMCSA email domain (${fd})` });
    else if (fd && contact.email!.trim().toLowerCase() !== fmcsa.email!.trim().toLowerCase())
      out.push({ level: "high", text: `Email ${contact.email} differs from FMCSA email ${fmcsa.email}` });
    else if (!fd) out.push({ level: "medium", text: "FMCSA has no email on file — verify by calling the FMCSA phone" });
    if (FREE_MAIL.has(cd) && cd !== fd) out.push({ level: "medium", text: `Free webmail (${cd}) — confirm with a callback` });
  }
  const cp = digits(contact.phone);
  if (cp.length === 10) {
    const fp = [digits(fmcsa.phone), digits(fmcsa.cell_phone)].filter((p) => p.length === 10);
    if (fp.includes(cp)) out.push({ level: "ok", text: "Phone matches FMCSA" });
    else out.push({ level: fp.length ? "high" : "medium", text: fp.length ? "Phone is not the FMCSA phone — call the FMCSA number to confirm the booking" : "FMCSA has no phone on file" });
  }
  return out;
}
