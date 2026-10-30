import type { jsPDF } from "jspdf";

/** Shown next to the "I accept" box on every signing page and printed on the certificate. */
export const ESIGN_CONSENT =
  "I agree to sign electronically. My typed name is my legal signature and has the same effect as signing by hand on paper.";
export const VERIFY_URL = "https://tms.clearwatercargo.com/verify";
const LEGAL_BASIS =
  "Signed electronically under the U.S. Electronic Signatures in Global and National Commerce Act (ESIGN, 15 U.S.C. 7001 et seq.) and the North Carolina Uniform Electronic Transactions Act (N.C.G.S. 66-311 et seq.).";

/** SHA-256 as lowercase hex. Works in the browser and on the server (Web Crypto). */
export async function sha256Hex(input: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** JSON with sorted keys, so the same terms always give the same fingerprint. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Client IP and device from the signing request (server only). */
export async function requestSigner() {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  const ip = (getRequestHeader("cf-connecting-ip") || getRequestHeader("x-real-ip") || getRequestHeader("x-forwarded-for") || "").split(",")[0]?.trim() || null;
  const ua = getRequestHeader("user-agent")?.slice(0, 500) || null;
  return { ip, ua };
}

export type CertInfo = {
  document: string; reference: string; parties: string;
  signer: string; signerTitle?: string | null; sentTo?: string | null;
  signedAt: string; ip?: string | null; device?: string | null;
  consent: string; termsSha256: string;
};

/** Appends the audit page (who, when, where, device, consent, terms fingerprint) to a signed PDF. */
export function addSignatureCertificate(doc: jsPDF, c: CertInfo) {
  doc.addPage("letter", "portrait");
  const L = 54, R = 558, W = R - L, LABEL = 150;
  let y = 60;
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold").setFontSize(15).text("Electronic Signature Certificate", L, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110).text("Clearwater Cargo LLC · P.O Box 100, Staley, NC 27355 · 252-497-7916", L, y + 14);
  doc.setTextColor(20);
  y += 28; doc.setDrawColor(180).setLineWidth(0.6).line(L, y, R, y); y += 20;
  const when = new Date(c.signedAt);
  const rows: [string, string, boolean?][] = [
    ["Document", c.document],
    ["Reference", c.reference],
    ["Parties", c.parties],
    ["Signed by", c.signer + (c.signerTitle ? `, ${c.signerTitle}` : "")],
    ["Signing link sent to", c.sentTo || "—"],
    ["Signed (Eastern time)", when.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "long", timeStyle: "long" })],
    ["Signed (UTC)", when.toISOString()],
    ["Time source", "Clearwater Cargo server clock (not the signer's device)"],
    ["IP address", c.ip || "Not recorded"],
    ["Device / browser", c.device || "Not recorded"],
    ["Consent given", `"${c.consent}"`],
    ["Terms fingerprint (SHA-256)", c.termsSha256, true],
  ];
  for (const [k, v, mono] of rows) {
    doc.setFont("helvetica", "bold").setFontSize(9.5).text(k, L, y);
    doc.setFont(mono ? "courier" : "helvetica", "normal").setFontSize(mono ? 8.5 : 9.5);
    const lines = doc.splitTextToSize(v, W - LABEL) as string[];
    doc.text(lines, L + LABEL, y, { lineHeightFactor: 1.3 });
    y += lines.length * 12.5 + 7;
  }
  y += 10;
  const how = doc.setFont("helvetica", "normal").setFontSize(9).splitTextToSize(
    `Clearwater Cargo saved a SHA-256 fingerprint of this complete PDF file at the moment it was signed. To confirm a copy has not been changed, upload it at ${VERIFY_URL}. Any change to the file, even one character, produces a different fingerprint. The terms fingerprint above identifies the exact terms the signer was shown.`,
    W - 20,
  ) as string[];
  const legal = doc.splitTextToSize(LEGAL_BASIS, W - 20) as string[];
  const h = 30 + how.length * 12 + 10 + legal.length * 11;
  doc.setDrawColor(15, 61, 62).setLineWidth(1).rect(L, y, W, h);
  doc.setFont("helvetica", "bold").setFontSize(10).text("How to check this copy", L + 10, y + 18);
  doc.setFont("helvetica", "normal").setFontSize(9).text(how, L + 10, y + 34, { lineHeightFactor: 1.3 });
  doc.setFontSize(8).setTextColor(90).text(legal, L + 10, y + 34 + how.length * 12 + 6, { lineHeightFactor: 1.3 });
  doc.setTextColor(120).setFontSize(7.5).text(`${c.reference} · Electronic Signature Certificate`, L, 770);
  doc.setTextColor(0);
}
