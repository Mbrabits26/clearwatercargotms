import { jsPDF } from "jspdf";
import { CW } from "./ratecon";
import { FF, loadImage } from "./invoice";
import logo from "@/assets/clearwater-logo.jpg.asset.json";

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

const TEAL: [number, number, number] = [15, 61, 62];
const GOLD: [number, number, number] = [191, 144, 0];

/** Branded, printer-friendly landscape PDF of any report table (white paper, repeating headers, page numbers). */
export function buildReportPdf(s: ReportSpec, img?: HTMLImageElement | null) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const L = 32, R = W - 32, avail = R - L, FS = 7.5, LH = 9;
  const fleet = s.company === "fleet";
  const co = fleet ? FF : CW;
  const right = new Set(s.right ?? []);
  const head = s.head.map(pdfSafe);

  // Letterhead
  let x = L;
  if (img && !fleet) { doc.addImage(img, "JPEG", L, 24, 46, 46); x = L + 56; }
  doc.setTextColor(0).setFont("helvetica", "bold").setFontSize(14).text(co.name, x, 40);
  doc.setFont("helvetica", "normal").setFontSize(8).text(`${co.addr1} · ${co.addr2} · ${co.phone}`, x, 52);
  doc.setFont("helvetica", "bold").setFontSize(16).text(pdfSafe(s.title).toUpperCase(), R, 40, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(8).text(`Generated ${new Date().toLocaleString("en-US")}`, R, 52, { align: "right" });
  doc.setDrawColor(...GOLD).setLineWidth(1.5).line(L, 76, R, 76).setLineWidth(0.5);
  let y = 90;
  if (s.subtitle) { doc.setFont("helvetica", "bold").setFontSize(9).text(doc.splitTextToSize(pdfSafe(s.subtitle), avail), L, y); y += 12; }
  if (s.filters?.length) {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(70);
    const t = doc.splitTextToSize(s.filters.map(pdfSafe).join("   |   "), avail);
    doc.text(t, L, y); y += t.length * 10 + 2; doc.setTextColor(0);
  }
  if (s.summary?.length) {
    const per = Math.min(6, s.summary.length), bw = (avail - (per - 1) * 6) / per;
    s.summary.forEach(([k, v], i) => {
      const bx = L + (i % per) * (bw + 6), by = y + Math.floor(i / per) * 38;
      doc.setDrawColor(200).rect(bx, by, bw, 32);
      doc.setFillColor(...GOLD).rect(bx, by, 3, 32, "F");
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(90).text(pdfSafe(k).toUpperCase(), bx + 8, by + 11);
      doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(0).text(pdfSafe(v), bx + 8, by + 25);
    });
    y += Math.ceil(s.summary.length / per) * 38 + 4;
  }

  // Column widths from content, scaled to the page.
  doc.setFontSize(FS).setFont("helvetica", "normal");
  const sample = s.rows.filter(Array.isArray).slice(0, 400) as string[][];
  const natural = head.map((h, i) => {
    doc.setFont("helvetica", "bold"); const hw = Math.min(90, doc.getTextWidth(h)); doc.setFont("helvetica", "normal");
    return Math.min(190, Math.max(26, hw, ...sample.map((r) => doc.getTextWidth(pdfSafe(r[i])))) + 8);
  });
  const scale = avail / natural.reduce((a, b) => a + b, 0);
  const widths = natural.map((w) => w * scale);
  const colX = widths.map((_, i) => L + widths.slice(0, i).reduce((a, b) => a + b, 0));

  const drawHead = () => {
    doc.setFont("helvetica", "bold").setFontSize(FS);
    const lines = head.map((h, i) => doc.splitTextToSize(h, widths[i]! - 6) as string[]);
    const h = Math.max(...lines.map((l) => l.length)) * LH + 6;
    doc.setFillColor(...TEAL).rect(L, y, avail, h, "F");
    doc.setTextColor(255);
    lines.forEach((l, i) => doc.text(l, right.has(i) ? colX[i]! + widths[i]! - 3 : colX[i]! + 3, y + 10, { align: right.has(i) ? "right" : "left" }));
    doc.setTextColor(0).setFont("helvetica", "normal");
    y += h;
  };
  const bottom = H - 36;
  const ensure = (h: number) => {
    if (y + h <= bottom) return;
    doc.addPage(); y = 32;
    doc.setFont("helvetica", "bold").setFontSize(9).text(`${pdfSafe(s.title)} (continued)`, L, y); y += 8;
    drawHead();
  };

  if (!s.head.length) return doc;
  drawHead();
  const drawCells = (cells: string[], bold: boolean, fill?: number) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(FS);
    const lines = head.map((_, i) => doc.splitTextToSize(pdfSafe(cells[i]), widths[i]! - 6) as string[]);
    const h = Math.max(1, ...lines.map((l) => l.length)) * LH + 5;
    ensure(h);
    if (fill !== undefined) doc.setFillColor(fill).rect(L, y, avail, h, "F");
    lines.forEach((l, i) => doc.text(l, right.has(i) ? colX[i]! + widths[i]! - 3 : colX[i]! + 3, y + 9, { align: right.has(i) ? "right" : "left" }));
    if (bold) doc.setDrawColor(120).line(L, y, R, y);
    y += h;
  };
  let zebra = false;
  for (const r of s.rows) {
    if (Array.isArray(r)) { drawCells(r, false, zebra ? 246 : undefined); zebra = !zebra; }
    else if ("subtotal" in r) { drawCells(r.subtotal, true); y += 4; zebra = false; }
    else {
      ensure(LH + 20);
      y += 3;
      doc.setFillColor(222, 236, 236).rect(L, y, avail, LH + 6, "F");
      doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...TEAL).text(doc.splitTextToSize(pdfSafe(r.group), avail - 8)[0] ?? "", L + 4, y + 10);
      doc.setTextColor(0); y += LH + 6; zebra = false;
    }
  }
  if (!s.rows.length) { ensure(20); doc.setFont("helvetica", "italic").setFontSize(9).text("Nothing matches this report.", L + 4, y + 14); y += 20; }
  if (s.total) { y += 2; drawCells(s.total, true, 232); }

  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(110);
    doc.text(`${co.name} · ${pdfSafe(s.title)}`, L, H - 18);
    doc.text(`Page ${p} of ${n}`, R, H - 18, { align: "right" });
    doc.setTextColor(0);
  }
  return doc;
}

const brandImg = (s: ReportSpec) => (s.company === "fleet" ? Promise.resolve(null) : loadImage(logo.url));

export async function downloadReportPdf(s: ReportSpec) {
  const doc = buildReportPdf(s, await brandImg(s));
  doc.save(reportFileName(s.title, "pdf"));
}

/** Opens the branded PDF in a new tab with the print dialog (falls back to a download if pop-ups are blocked). */
export async function printReport(s: ReportSpec) {
  const w = window.open("", "_blank");
  try {
    const doc = buildReportPdf(s, await brandImg(s));
    doc.autoPrint();
    const url = String(doc.output("bloburl"));
    if (w) w.location.href = url;
    else doc.save(reportFileName(s.title, "pdf"));
  } catch (e) { w?.close(); throw e; }
}
