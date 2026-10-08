import { jsPDF } from "jspdf";
import { CW } from "./ratecon";
import type { Accessorial, Company, Load } from "./tms";

const money = (n: number) => `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-US") : "");

/** Branded customer invoice (AR) for one load. Amount comes from the queued accounting row. */
export function buildInvoicePdf(o: { invoiceNumber: string; load: Load; billTo?: Company; amount: number; logoUrl?: string; logo?: HTMLImageElement | null }) {
  const { load, billTo } = o;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const L = 48, R = 564;
  if (o.logo) doc.addImage(o.logo, "JPEG", L, 36, 70, 70);
  doc.setFont("helvetica", "bold").setFontSize(18).text(CW.name, L + 84, 58);
  doc.setFont("helvetica", "normal").setFontSize(10).text([CW.addr1, CW.addr2, CW.phone], L + 84, 74);
  doc.setFont("helvetica", "bold").setFontSize(26).text("INVOICE", R, 58, { align: "right" });
  doc.setFontSize(10).setFont("helvetica", "normal");
  doc.text([`Invoice #: ${o.invoiceNumber}`, `Date: ${new Date().toLocaleDateString("en-US")}`, `Load #: ${load.load_number}`, "Terms: Net 30"], R, 76, { align: "right" });
  let y = 140;
  doc.setFont("helvetica", "bold").text("BILL TO", L, y);
  doc.setFont("helvetica", "normal").text([billTo?.name ?? "—", billTo?.address ?? "", [billTo?.city, billTo?.state, billTo?.zip].filter(Boolean).join(", ")].filter(Boolean), L, y + 14);
  doc.setFont("helvetica", "bold").text("SHIPMENT", 320, y);
  doc.setFont("helvetica", "normal").text([
    `${load.origin_city}, ${load.origin_state} → ${load.dest_city}, ${load.dest_state}`.replace("→", "to"),
    `Picked up: ${d(load.pickup_at)}   Delivered: ${d(load.delivery_at)}`,
    `Equipment: ${load.equipment}${load.commodity ? ` · ${load.commodity}` : ""}`,
    [load.ship_ref && `Ship ref: ${load.ship_ref}`, load.dest_ref && `Dest ref: ${load.dest_ref}`].filter(Boolean).join("   "),
  ].filter(Boolean), 320, y + 14);
  y = 230;
  doc.setFillColor(15, 61, 62).rect(L, y, R - L, 20, "F");
  doc.setTextColor(255).setFont("helvetica", "bold").text("Description", L + 8, y + 14).text("Amount", R - 8, y + 14, { align: "right" });
  doc.setTextColor(0).setFont("helvetica", "normal");
  const acc = ((load.accessorials as Accessorial[] | null) ?? []);
  const accSum = acc.reduce((s, a) => s + Number(a.amount || 0), 0);
  const rows: [string, number][] = [["Linehaul", o.amount - accSum], ...acc.map((a) => [a.type || "Accessorial", Number(a.amount || 0)] as [string, number])];
  y += 20;
  for (const [k, v] of rows) { y += 18; doc.text(String(k), L + 8, y).text(money(v), R - 8, y, { align: "right" }); doc.setDrawColor(220).line(L, y + 5, R, y + 5); }
  y += 30;
  doc.setFont("helvetica", "bold").setFontSize(13).text(`TOTAL DUE  ${money(o.amount)}`, R - 8, y, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).text(`Please remit to ${CW.name}, ${CW.addr1}, ${CW.addr2}. Reference invoice ${o.invoiceNumber} with payment.`, L, 720);
  return doc;
}

export const loadImage = (url: string) => new Promise<HTMLImageElement | null>((res) => {
  const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = url;
});
