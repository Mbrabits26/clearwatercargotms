import { jsPDF } from "jspdf";
import { CW } from "./ratecon";
import { FF } from "./invoice";

/** A data row, a group heading spanning the table, or a bold subtotal row. */
export type ReportRow = string[] | { group: string } | { subtotal: string[] };
export type ReportSpec = {
  title: string;
  subtitle?: string;
  /** Letterhead: Clearwater Cargo (default) or Foust Farms for fleet reports. */
  company?: "brokerage" | "fleet";
  /** One line per active filter, e.g. "Dates: Year to date". */
  filters?: string[];
  /** Headline numbers printed as boxes above the table. */
  summary?: [string, string][];
  head: string[];
  rows: ReportRow[];
  total?: string[];
  /** Column indexes to right-align (money, counts). */
  right?: number[];
};

const cellsOf = (r: ReportRow) => (Array.isArray(r) ? r : "group" in r ? [r.group] : r.subtotal);

/** Built-in PDF fonts only cover Latin-1, so swap arrows and other symbols for plain text. */
export const pdfSafe = (v: unknown) =>
  String(v ?? "").replace(/\s*→\s*/g, " to ").replace(/[−–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, "...").replace(/[^\x00-\xff]/g, "");

/** CSV with title, filters and summary on top, then the table. Opens cleanly in Excel. */
export function reportCsv(s: ReportSpec): string {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const meta: string[][] = [[s.title], ...(s.subtitle ? [[s.subtitle]] : []), ...(s.filters ?? []).map((f) => [f]), ...(s.summary ?? []).map(([k, v]) => [k, v]), [`Generated ${new Date().toLocaleString("en-US")}`], []];
  const lines = [...meta, s.head, ...s.rows.map(cellsOf), ...(s.total ? [s.total] : [])];
  return lines.map((l) => l.map(q).join(",")).join("\r\n");
}

export const reportFileName = (title: string, ext: "csv" | "pdf") =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "report"}-${new Date().toISOString().slice(0, 10)}.${ext}`;

export function downloadReportCsv(s: ReportSpec) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF" + reportCsv(s)], { type: "text/csv;charset=utf-8" }));
  a.download = reportFileName(s.title, "csv");
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Plain, printer-friendly landscape PDF of any report table: black text on white, no logo, colors or boxes. */
export function buildReportPdf(s: ReportSpec) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const L = 36, R = W - 36, avail = R - L, FS = 8, LH = 9.5;
  const co = s.company === "fleet" ? FF : CW;
  const right = new Set(s.right ?? []);
  const head = s.head.map(pdfSafe);
  doc.setTextColor(0).setDrawColor(0);

  // Simple heading: title, company, date, filters and totals as plain text.
  doc.setFont("helvetica", "bold").setFontSize(14).text(pdfSafe(s.title), L, 44);
  doc.setFont("helvetica", "normal").setFontSize(8.5).text(co.name, L, 57);
  doc.text(`Printed ${new Date().toLocaleString("en-US")}`, R, 57, { align: "right" });
  let y = 72;
  const para = (text: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(8.5);
    const t = doc.splitTextToSize(pdfSafe(text), avail) as string[];
    doc.text(t, L, y); y += t.length * 11;
  };
  if (s.subtitle) para(s.subtitle, true);
  if (s.filters?.length) para(s.filters.join("   |   "));
  if (s.summary?.length) para(s.summary.map(([k, v]) => `${k}: ${v}`).join("     "), true);
  y += 4;

  // Column widths from content, scaled to the page.
  doc.setFontSize(FS).setFont("helvetica", "normal");
  const sample = s.rows.filter(Array.isArray).slice(0, 400) as string[][];
  const natural = head.map((h, i) => {
    doc.setFont("helvetica", "bold"); const hw = Math.min(90, doc.getTextWidth(h)); doc.setFont("helvetica", "normal");
    return Math.min(190, Math.max(26, hw, ...sample.map((r) => doc.getTextWidth(pdfSafe(r[i])))) + 8);
  });
  const scale = avail / Math.max(1, natural.reduce((a, b) => a + b, 0));
  const widths = natural.map((w) => w * scale);
  const colX = widths.map((_, i) => L + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const textAt = (l: string[], i: number, ty: number) =>
    doc.text(l, right.has(i) ? colX[i]! + widths[i]! - 3 : colX[i]! + 3, ty, { align: right.has(i) ? "right" : "left" });

  const drawHead = () => {
    doc.setFont("helvetica", "bold").setFontSize(FS);
    const lines = head.map((h, i) => doc.splitTextToSize(h, widths[i]! - 6) as string[]);
    const h = Math.max(...lines.map((l) => l.length)) * LH + 5;
    doc.setLineWidth(0.8).line(L, y, R, y);
    lines.forEach((l, i) => textAt(l, i, y + 10));
    y += h;
    doc.line(L, y, R, y).setLineWidth(0.3).setFont("helvetica", "normal");
  };
  const bottom = H - 36;
  const ensure = (h: number) => {
    if (y + h <= bottom) return;
    doc.addPage(); y = 36;
    doc.setFont("helvetica", "bold").setFontSize(9).text(`${pdfSafe(s.title)} (continued)`, L, y); y += 8;
    drawHead();
  };

  if (!s.head.length) return doc;
  drawHead();
  const drawCells = (cells: string[], bold: boolean) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(FS);
    const lines = head.map((_, i) => doc.splitTextToSize(pdfSafe(cells[i]), widths[i]! - 6) as string[]);
    const h = Math.max(1, ...lines.map((l) => l.length)) * LH + 5;
    ensure(h);
    if (bold) doc.setLineWidth(0.6).line(L, y, R, y).setLineWidth(0.3);
    lines.forEach((l, i) => textAt(l, i, y + 9.5));
    y += h;
    if (!bold) doc.setDrawColor(190).line(L, y, R, y).setDrawColor(0);
  };
  for (const r of s.rows) {
    if (Array.isArray(r)) drawCells(r, false);
    else if ("subtotal" in r) { drawCells(r.subtotal, true); y += 6; }
    else {
      ensure(LH + 22);
      y += 6;
      doc.setFont("helvetica", "bold").setFontSize(9).text(doc.splitTextToSize(pdfSafe(r.group), avail)[0] ?? "", L + 3, y + 10);
      y += LH + 6;
    }
  }
  if (!s.rows.length) { ensure(20); doc.setFont("helvetica", "italic").setFontSize(9).text("Nothing matches this report.", L + 3, y + 14); y += 20; }
  if (s.total) { y += 2; drawCells(s.total, true); doc.setLineWidth(0.8).line(L, y, R, y); }

  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(0);
    doc.text(`${co.name} - ${pdfSafe(s.title)}`, L, H - 18);
    doc.text(`Page ${p} of ${n}`, R, H - 18, { align: "right" });
  }
  return doc;
}

export function downloadReportPdf(s: ReportSpec) {
  buildReportPdf(s).save(reportFileName(s.title, "pdf"));
}

/**
 * Prints the plain PDF (not the screen): loads it in a hidden frame and opens the print dialog,
 * where "Save as PDF" also works. Falls back to downloading the PDF if the browser won't print it.
 */
export function printReport(s: ReportSpec) {
  const doc = buildReportPdf(s);
  const url = URL.createObjectURL(doc.output("blob"));
  // Safari can't print a PDF inside a frame; give it its own tab with the print dialog built in.
  if (/^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)) {
    doc.autoPrint();
    const w = window.open(String(doc.output("bloburl")), "_blank");
    if (!w) doc.save(reportFileName(s.title, "pdf"));
    return;
  }
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  const cleanup = () => setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000);
  frame.onload = () => {
    try { frame.contentWindow?.focus(); frame.contentWindow?.print(); }
    catch { doc.save(reportFileName(s.title, "pdf")); }
    cleanup();
  };
  frame.src = url;
  document.body.appendChild(frame);
}

/** "2026-10-23" → "10/23/2026" for filter lines. */
export const dayText = (d: string) => new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US");

/** Filter line for a From/To date pair, e.g. "Delivery dates: 1/1/2026 to 10/23/2026". */
export const datesLine = (label: string, from: string, to: string) =>
  from || to ? `${label}: ${from ? dayText(from) : "start"} to ${to ? dayText(to) : "today"}` : `${label}: All dates`;
