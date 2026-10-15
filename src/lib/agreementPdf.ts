import { jsPDF } from "jspdf";
import { agreementLegalHtml } from "@/content/agreement-legal";

export type AgreementSigner = {
  legal_name: string; dba?: string | null; mc_number?: string | null; dot_number?: string | null;
  contact_name?: string | null; email?: string | null; phone?: string | null; pay_terms?: string | null;
  signer_name: string; signed_at: string; signer_ip?: string | null; reference: string;
};

const PAY: Record<string, string> = {
  net30: "Net 30 (no fee)", quickpay: "Quick Pay - 5% fee, paid in 3 days",
  factoring: "Factoring - Net 30, paid to factoring company", factored_quickpay: "Factored Quick Pay - 2.5% fee",
};

/** Agreement HTML -> plain paragraphs (headings flagged with a leading "#"). */
function paragraphs() {
  return agreementLegalHtml
    .replace(/<div class="legal-section-head">([\s\S]*?)<\/div>/g, "\n#$1\n")
    .replace(/<div class="legal-subsub"><strong>([\s\S]*?)<\/strong>/g, "\n    $1 ")
    .replace(/<div class="legal-sub"><strong>([\s\S]*?)<\/strong>/g, "\n$1 ")
    .replace(/<\/(p|div)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/§/g, "Sec. ")
    .split("\n").map((s) => s.replace(/\s+/g, " ").trimEnd()).filter((s) => s.trim());
}

/** Signed Clearwater Cargo broker-carrier agreement (same text the carrier accepts on the portal). */
export function buildAgreementPdf(s: AgreementSigner): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const L = 54, R = 558, W = R - L, BOTTOM = 740;
  let y = 54;
  const page = () => { doc.addPage(); y = 54; };
  const need = (h: number) => { if (y + h > BOTTOM) page(); };
  doc.setFont("helvetica", "bold").setFontSize(16).text("Clearwater Cargo LLC", L, y);
  doc.setFont("helvetica", "normal").setFontSize(9).text("P.O Box 100, Staley, NC 27355 · 252-497-7916", L, y + 14);
  doc.setFont("helvetica", "bold").setFontSize(13).text("BROKER-CARRIER AGREEMENT", R, y, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).text(`Ref ${s.reference}`, R, y + 14, { align: "right" });
  y += 36;
  doc.setDrawColor(180).line(L, y, R, y); y += 16;
  const date = new Date(s.signed_at);
  const rows: [string, string][] = [
    ["Carrier", s.legal_name + (s.dba ? ` (DBA ${s.dba})` : "")],
    ["MC / DOT", [s.mc_number && `MC ${s.mc_number}`, s.dot_number && `USDOT ${s.dot_number}`].filter(Boolean).join(" · ") || "—"],
    ["Contact", [s.contact_name, s.phone, s.email].filter(Boolean).join(" · ") || "—"],
    ["Pay option", PAY[s.pay_terms ?? ""] ?? "Net 30"],
    ["Agreement date", date.toLocaleDateString("en-US")],
  ];
  doc.setFontSize(9.5);
  for (const [k, v] of rows) { doc.setFont("helvetica", "bold").text(k, L, y); doc.setFont("helvetica", "normal").text(doc.splitTextToSize(v, W - 100), L + 100, y); y += 14; }
  y += 8;
  doc.setFontSize(8.5);
  for (const p of paragraphs()) {
    const head = p.startsWith("#");
    const indent = p.startsWith("    ") ? 18 : 0;
    doc.setFont("helvetica", head ? "bold" : "normal").setFontSize(head ? 9.5 : 8.5);
    const lines = doc.splitTextToSize(head ? p.slice(1) : p.trim(), W - indent) as string[];
    if (head) y += 6;
    for (const ln of lines) { need(11); doc.text(ln, L + indent, y); y += 11; }
    y += 3;
  }
  need(150); y += 16;
  doc.setDrawColor(15, 61, 62).setLineWidth(1).rect(L, y, W, 130);
  doc.setFont("helvetica", "bold").setFontSize(10).text("ELECTRONIC SIGNATURE", L + 10, y + 18);
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text([`CARRIER: ${s.legal_name}`, `Signed by: ${s.signer_name}`, `Signed: ${date.toLocaleString("en-US", { timeZone: "America/New_York" })} ET`,
    `Signer IP: ${s.signer_ip || "—"}`, "Accepted online through the Clearwater Cargo carrier onboarding portal."], L + 10, y + 34, { lineHeightFactor: 1.4 });
  doc.setFont("times", "italic").setFontSize(20).text(s.signer_name, R - 12, y + 60, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).text("BROKER: Clearwater Cargo LLC", R - 12, y + 112, { align: "right" });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7.5).setTextColor(120).text(`${s.legal_name} · Broker-Carrier Agreement · Page ${i} of ${n}`, L, 770); doc.setTextColor(0); }
  return doc;
}
