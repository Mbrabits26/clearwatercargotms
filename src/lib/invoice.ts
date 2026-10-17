import { jsPDF } from "jspdf";
import { CW } from "./ratecon";
import type { Accessorial, Company, Load } from "./tms";
import { deductionLines } from "./invoiceDeductions";

/** Internal fleet billing entity (separate MC/DOT from the brokerage). */
export const FF = { name: "Foust Farms Truckin LLC", addr1: "1392 Shady Grove Church Road", addr2: "Staley, NC 27355", phone: "336-622-9527", authority: "MC 775739 · USDOT 2271564" };

const money = (n: number) => `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-US") : "");

/** Branded customer invoice (AR). One load, or — with `lines` — one combined invoice itemized per load. */
export function buildInvoicePdf(o: { invoiceNumber: string; terms?: string; dueDate?: string; invoiceDate?: string; load: Load; billTo?: Company; amount: number; logoUrl?: string; logo?: HTMLImageElement | null; fleet?: boolean; lines?: { load: Load; amount: number; deductions?: unknown }[]; deductions?: unknown }) {
  const { load, billTo } = o;
  const multi = (o.lines?.length ?? 0) > 1;
  const co = o.fleet ? FF : CW;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const L = 48, R = 564;
  const X = o.fleet ? L : L + 84;
  if (o.logo && !o.fleet) doc.addImage(o.logo, "JPEG", L, 36, 70, 70);
  doc.setFont("helvetica", "bold").setFontSize(18).text(co.name, X, 58);
  doc.setFont("helvetica", "normal").setFontSize(10).text([co.addr1, co.addr2, co.phone, ...(o.fleet ? [FF.authority] : [])], X, 74);
  doc.setFont("helvetica", "bold").setFontSize(26).text("INVOICE", R, 58, { align: "right" });
  doc.setFontSize(10).setFont("helvetica", "normal");
  doc.text([`Invoice #: ${o.invoiceNumber}`, `Date: ${new Date(o.invoiceDate ?? Date.now()).toLocaleDateString("en-US")}`, multi ? `Loads: ${o.lines!.length}` : `Load #: ${load.load_number}`, `Terms: ${o.terms ?? "Net 30"}`, ...(o.dueDate ? [`Due: ${new Date(o.dueDate + "T12:00:00").toLocaleDateString("en-US")}`] : [])], R, 76, { align: "right" });
  let y = 140;
  doc.setFont("helvetica", "bold").text("BILL TO", L, y);
  doc.setFont("helvetica", "normal").text([billTo?.name ?? "—", billTo?.address ?? "", [billTo?.city, billTo?.state, billTo?.zip].filter(Boolean).join(", ")].filter(Boolean), L, y + 14);
  if (!multi) {
  doc.setFont("helvetica", "bold").text("SHIPMENT", 320, y);
  doc.setFont("helvetica", "normal").text([
    `${load.origin_city}, ${load.origin_state} → ${load.dest_city}, ${load.dest_state}`.replace("→", "to"),
    `Picked up: ${d(load.pickup_at)}   Delivered: ${d(load.delivery_at)}`,
    `Equipment: ${load.equipment}${load.commodity ? ` · ${load.commodity}` : ""}`,
    [load.ship_ref && `Ship ref: ${load.ship_ref}`, load.dest_ref && `Dest ref: ${load.dest_ref}`].filter(Boolean).join("   "),
  ].filter(Boolean), 320, y + 14);
  }
  y = 230;
  doc.setFillColor(15, 61, 62).rect(L, y, R - L, 20, "F");
  doc.setTextColor(255).setFont("helvetica", "bold").text("Description", L + 8, y + 14).text("Amount", R - 8, y + 14, { align: "right" });
  doc.setTextColor(0).setFont("helvetica", "normal");
  let rows: [string, number][];
  if (multi) {
    rows = o.lines!.map(({ load: l, amount }) => [`${l.load_number}  ${l.origin_city}, ${l.origin_state} to ${l.dest_city}, ${l.dest_state}  · Del ${d(l.delivery_at)}${l.ship_ref ? ` · Ref ${l.ship_ref}` : ""}`, amount]);
  } else {
    const acc = ((load.accessorials as Accessorial[] | null) ?? []);
    const accSum = acc.reduce((s, a) => s + Number(a.amount || 0), 0);
    rows = [["Linehaul", o.amount - accSum], ...acc.map((a) => [a.type || "Accessorial", Number(a.amount || 0)] as [string, number])];
  }
  // Percentage deductions (per load on combined invoices) print as negative lines.
  const ded: [string, number][] = multi
    ? o.lines!.flatMap((x) => deductionLines(x.amount, x.deductions).map((dl) => [`${dl.label} — ${x.load.load_number}`, dl.amount] as [string, number]))
    : deductionLines(o.amount, o.deductions).map((dl) => [dl.label, dl.amount] as [string, number]);
  rows = [...rows, ...ded];
  const totalDue = Math.max(0, rows.reduce((s, [, v]) => s + v, 0));
  y += 20;
  for (const [k, v] of rows) {
    if (y > 680) { doc.addPage(); y = 60; }
    y += 18; doc.text(String(k).slice(0, 95), L + 8, y).text(money(v), R - 8, y, { align: "right" }); doc.setDrawColor(220).line(L, y + 5, R, y + 5);
  }
  y += 30;
  doc.setFont("helvetica", "bold").setFontSize(13).text(`TOTAL DUE  ${money(ded.length ? totalDue : o.amount)}`, R - 8, y, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).text(`Please remit to ${co.name}, ${co.addr1}, ${co.addr2}. Reference invoice ${o.invoiceNumber} with payment.`, L, 720);
  return doc;
}

export const loadImage = (url: string) => new Promise<HTMLImageElement | null>((res) => {
  const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = url;
});
