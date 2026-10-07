import { jsPDF } from "jspdf";
import type { Tables } from "@/integrations/supabase/types";
import { CW } from "./ratecon";
import type { Accessorial } from "./tms";

export type Quote = Tables<"quotes">;
const money = (n: number) => `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function toDataUrl(url: string) {
  try {
    const b = await (await fetch(url)).blob();
    return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); });
  } catch { return null; }
}

export async function buildQuotePdf(q: Quote, logoUrl: string) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const L = 40, R = 572;
  doc.setFillColor(10, 10, 10); doc.rect(0, 0, 612, 90, "F");
  const logo = await toDataUrl(logoUrl);
  if (logo) doc.addImage(logo, "JPEG", L, 15, 60, 60);
  doc.setTextColor(212, 160, 23); doc.setFont("helvetica", "bold"); doc.setFontSize(22);
  doc.text("CLEARWATER CARGO", L + 75, 45);
  doc.setFontSize(10); doc.setTextColor(200, 200, 200); doc.setFont("helvetica", "normal");
  doc.text(`${CW.addr1} · ${CW.addr2} · ${CW.phone}`, L + 75, 62);
  doc.setTextColor(212, 160, 23); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text(q.kind === "contract" ? "CONTRACT RATE QUOTE" : "SPOT QUOTE", R, 45, { align: "right" });
  doc.setFontSize(10); doc.setTextColor(200, 200, 200);
  doc.text(q.quote_number, R, 62, { align: "right" });

  doc.setTextColor(20, 20, 20);
  let y = 125;
  const row = (k: string, v: string) => { doc.setFont("helvetica", "bold"); doc.text(k, L, y); doc.setFont("helvetica", "normal"); doc.text(v, L + 140, y); y += 18; };
  doc.setFontSize(11);
  row("Prepared for", q.customer_name ?? "");
  row("Date", new Date(q.created_at).toLocaleDateString());
  row("Valid until", new Date(q.expires_at).toLocaleString());
  y += 8;
  row("Origin", `${q.origin_city}, ${q.origin_state}`);
  row("Destination", `${q.dest_city}, ${q.dest_state}`);
  row("Equipment", q.equipment);
  if (q.miles) row("Miles", q.miles.toLocaleString());
  if (q.pickup_date) row("Pickup", q.pickup_date);
  y += 10;
  doc.setDrawColor(212, 160, 23); doc.line(L, y, R, y); y += 22;
  const acc = ((q.accessorials as Accessorial[]) ?? []).filter((a) => Number(a.amount));
  row("Linehaul (all-in)", money(Number(q.rate)));
  acc.forEach((a) => row(a.type, money(Number(a.amount))));
  const total = Number(q.rate) + acc.reduce((s, a) => s + Number(a.amount), 0);
  doc.setFontSize(14); row("TOTAL", money(total));
  if (q.miles) { doc.setFontSize(10); row("Rate per mile", `$${(total / q.miles).toFixed(2)}`); }
  doc.setFontSize(10);
  if (q.notes) { y += 10; doc.text(doc.splitTextToSize(`Notes: ${q.notes}`, R - L), L, y); y += 30; }
  y += 10;
  doc.setTextColor(110, 110, 110);
  doc.text(doc.splitTextToSize(`This quote is valid for 24 hours from issue and subject to equipment availability at time of tender. Detention, layover, TONU and lumper charges billed as incurred with receipts. ${CW.name} · ${CW.phone}`, R - L), L, y);
  return doc;
}
