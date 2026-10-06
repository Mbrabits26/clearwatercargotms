import { jsPDF } from "jspdf";
import { type Accessorial, type Carrier, type Company, type Load } from "./tms";

export const CW = { name: "Clearwater Cargo LLC", addr1: "P.O Box 100", addr2: "Staley, NC 27355", phone: "252-497-7916" };

/** Serializable snapshot of everything printed on a rate con (what the carrier signs). */
export type RateConData = {
  rc: string; shipRef: string; destRef: string; date: string;
  lane: string; pickup: string; delivery: string;
  carrier: string; carrierMc: string; equipment: string; customer: string; terms: string; remitTo: string;
  lines: { label: string; amount: number }[]; total: number;
  shipper: { name: string; addr: string; cityLine: string; phone: string };
  consignee: { name: string; addr: string; cityLine: string; phone: string };
  commodity: string; type: string; weight: number | null; qty: number | null; hazmat: string;
  notes: string;
};
export type Signature = { name: string; title?: string; signedAt: string };

const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : "");
const mmddyyyy = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
const money = (n: number) => `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const party = (c: Company | undefined, city: string, st: string) => ({
  name: c?.name ?? "",
  addr: c?.address ?? "",
  cityLine: c ? `${c.city ?? city}, ${c.state ?? st} ${c.zip ?? ""}`.trim() : `${city}, ${st}`,
  phone: c?.phone ?? "",
});

export function buildRateConData(o: { load: Load; carrier: Carrier; shipper?: Company; consignee?: Company; customer?: Company }): RateConData {
  const { load, carrier } = o;
  const acc = ((load.accessorials as Accessorial[]) ?? []).filter((a) => Number(a.amount));
  const lines = [{ label: "Linehaul", amount: Number(load.carrier_rate) }, ...acc.map((a) => ({ label: a.type, amount: Number(a.amount) }))];
  const notes = [load.pickup_notes && `Pickup: ${load.pickup_notes}`, load.delivery_notes && `Delivery: ${load.delivery_notes}`, load.temperature && `Temperature: ${load.temperature}`]
    .filter(Boolean).join("\n");
  return {
    rc: load.load_number, shipRef: load.ship_ref ?? "", destRef: load.dest_ref ?? "", date: mmddyyyy(new Date()),
    lane: `${load.origin_city}, ${load.origin_state} to ${load.dest_city}, ${load.dest_state}`,
    pickup: d10(load.pickup_at), delivery: d10(load.delivery_at),
    carrier: carrier.legal_name, carrierMc: carrier.mc_number ? `MC ${carrier.mc_number}` : carrier.dot_number ? `DOT ${carrier.dot_number}` : "",
    equipment: load.equipment, customer: o.customer?.name ?? "",
    terms: "Net 30 · Quick Pay @ 3%",
    remitTo: carrier.factoring_company ? `${carrier.factoring_company} (NOA on file)` : carrier.legal_name,
    lines, total: lines.reduce((s, l) => s + l.amount, 0),
    shipper: party(o.shipper, load.origin_city, load.origin_state),
    consignee: party(o.consignee, load.dest_city, load.dest_state),
    commodity: load.commodity ?? "", type: "", weight: load.weight_lbs, qty: load.pieces, hazmat: "",
    notes,
  };
}

const LEGAL = `All accessorials or additional services not on this confirmation require a prior authorization code. Call ${CW.phone} to receive this code. All accessorials or additional services must be clearly marked and signed on the Bill of Lading including in/out times if detention occurs. Any charges not on this confirmation that are billed to ${CW.name} must have an accompanying authorization code in order for payment to be remitted. Receipts are required for lumpers. This document is intended to satisfy the requirements contained in 49 CFR-1-53.1. ${CW.name} tenders this freight with the express understanding that company employees or permanently leased owner-operators will transport these goods. ${CW.name} does not extend authority to the contract carrier to trip-lease or re-broker the freight.`;

export function buildRateConPdf(r: RateConData, sig?: Signature): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const L = 40, R = 572, W = R - L;
  const gray: [number, number, number] = [110, 110, 110];
  const ink = () => doc.setTextColor(20, 20, 20);
  const font = (s: number, b = false) => { doc.setFontSize(s); doc.setFont("helvetica", b ? "bold" : "normal"); };
  const box = (x: number, y: number, w: number, h: number, fill = false) => {
    doc.setDrawColor(200); doc.setLineWidth(0.6);
    if (fill) { doc.setFillColor(244, 244, 244); doc.rect(x, y, w, h, "FD"); } else doc.rect(x, y, w, h);
  };
  const kv = (k: string, v: string, x: number, y: number, rightAlign = false) => {
    font(8.5, true); ink();
    if (rightAlign) {
      font(8.5, true); const vw = doc.getTextWidth(v); doc.text(v, x, y, { align: "right" });
      font(8.5); doc.setTextColor(...gray); doc.text(`${k} `, x - vw, y, { align: "right" });
    } else {
      doc.text(`${k} `, x, y); const kw = doc.getTextWidth(`${k} `); font(8.5); doc.text(v, x + kw, y);
    }
  };

  // Header
  ink(); font(18, true); doc.text(CW.name, L, 58);
  doc.text("Rate Confirmation", R, 58, { align: "right" });
  font(8.5); doc.setTextColor(...gray);
  doc.text([CW.addr1, CW.addr2, `Phone: ${CW.phone}`], L, 80, { lineHeightFactor: 1.35 });
  kv("RC #:", r.rc, R, 80, true);
  kv("Ship Ref:", r.shipRef, R, 92, true);
  kv("Dest Ref:", r.destRef, R, 104, true);
  kv("Date:", r.date, R, 116, true);

  // Load bar
  let y = 126;
  doc.setDrawColor(20); doc.setLineWidth(1.5); doc.line(L - 4, y, R + 4, y);
  doc.setFillColor(244, 244, 244); doc.rect(L - 4, y + 1, W + 8, 18, "F");
  kv("Load:", r.lane, L + 4, y + 13);
  kv("Pickup:", r.pickup, L + 230, y + 13);
  kv("Req Del:", r.delivery, L + 380, y + 13);

  // Three columns
  y += 26;
  const cw = [W * 0.36, W * 0.3, W * 0.34];
  const cx = [L - 4, L - 4 + cw[0]!, L - 4 + cw[0]! + cw[1]!];
  const top = y, bodyH = 106;
  ["Bill To", "Load / Carrier", "Rate Summary"].forEach((t, i) => {
    box(cx[i]!, top, cw[i]! + (i === 2 ? 8 : 0), 20, true);
    font(8.5, true); ink(); doc.text(t, cx[i]! + 6, top + 13);
    box(cx[i]!, top + 20, cw[i]! + (i === 2 ? 8 : 0), bodyH);
  });
  let by = top + 36;
  font(8.5, true); ink(); doc.text(CW.name, cx[0]! + 6, by);
  font(8.5); doc.text([CW.addr1, CW.addr2], cx[0]! + 6, by + 11, { lineHeightFactor: 1.35 });
  doc.setTextColor(...gray); doc.text("Contact:", cx[0]! + 6, by + 37);
  doc.text("Phone: ", cx[0]! + 6, by + 49); ink(); doc.text(CW.phone, cx[0]! + 6 + doc.getTextWidth("Phone: "), by + 49);

  const c2 = cx[1]! + 6, c2w = cw[1]! - 12;
  kv("Carrier:", "", c2, by); font(8.5); doc.text(doc.splitTextToSize(r.carrier, c2w - 36)[0] ?? "", c2 + 36, by);
  kv("Equipment:", r.equipment, c2, by + 12);
  font(8.5); doc.setTextColor(...gray);
  const cust = doc.splitTextToSize(`Customer: ${r.customer}`, c2w);
  doc.text(cust, c2, by + 24, { lineHeightFactor: 1.35 });
  let cy = by + 24 + cust.length * 11.5;
  doc.text(`RC #: ${r.rc}`, c2, cy); cy += 11.5;
  doc.text(`Terms: ${r.terms}`, c2, cy); cy += 11.5;
  doc.text(doc.splitTextToSize(`Remit to: ${r.remitTo}`, c2w), c2, cy, { lineHeightFactor: 1.35 });

  const c3 = cx[2]! + 12, c3r = R - 4;
  let ry = by;
  font(8.5);
  r.lines.forEach((ln) => {
    doc.setTextColor(...gray); doc.text(ln.label, c3, ry); ink(); doc.text(money(ln.amount), c3r, ry, { align: "right" });
    ry += 12;
  });
  doc.setDrawColor(220); doc.line(c3, ry - 6, c3r, ry - 6);
  font(8.5, true); doc.text("Total to Carrier", c3, ry + 14);
  font(11, true); doc.text(money(r.total), c3r, ry + 14, { align: "right" });

  // Shipper / consignee
  y = top + 20 + bodyH;
  const half = (W + 8) / 2;
  [["Shipper (Origin)", r.shipper], ["Consignee (Destination)", r.consignee]].forEach(([t, p], i) => {
    const x = L - 4 + i * half, pp = p as RateConData["shipper"];
    box(x, y, half, 20, true); font(8.5, true); ink(); doc.text(t as string, x + 6, y + 13);
    box(x, y + 20, half, 60);
    font(8.5, true); doc.text(pp.name, x + 6, y + 34);
    font(8.5); doc.text([pp.addr, pp.cityLine], x + 6, y + 46, { lineHeightFactor: 1.35 });
    doc.setTextColor(...gray); doc.text("Phone: ", x + 6, y + 70); ink(); doc.text(pp.phone, x + 6 + doc.getTextWidth("Phone: "), y + 70);
  });

  // Commodity table
  y += 92;
  const col = { desc: L, type: L + 250, wt: L + 380, qty: L + 435, hz: L + 455 };
  font(8.5, true); ink();
  doc.text("Description", col.desc, y); doc.text("Type", col.type, y);
  doc.text("Weight (lbs)", col.wt, y, { align: "right" }); doc.text("Qty", col.qty, y, { align: "right" }); doc.text("HazMat", col.hz, y);
  doc.setDrawColor(200); doc.line(L - 4, y + 5, R - 40, y + 5);
  y += 20; font(8.5);
  const w = r.weight ? r.weight.toLocaleString() : "", q = r.qty ? String(r.qty) : "";
  doc.text(r.commodity, col.desc, y); doc.text(r.type, col.type, y);
  doc.text(w, col.wt, y, { align: "right" }); doc.text(q, col.qty, y, { align: "right" }); doc.text(r.hazmat, col.hz, y);
  doc.line(L - 4, y + 6, R - 40, y + 6);
  y += 20; font(8.5, true);
  doc.text("Totals:", col.desc, y); doc.text(w, col.wt, y, { align: "right" }); doc.text(q, col.qty, y, { align: "right" });
  doc.line(L - 4, y + 6, R - 40, y + 6);

  // Notes
  y += 14;
  const noteLines = doc.splitTextToSize(r.notes || " ", W - 4);
  const nh = 26 + noteLines.length * 11;
  box(L - 4, y, W + 8, nh);
  font(8.5, true); doc.text("Delivery Notes", L + 2, y + 14);
  font(8.5); doc.text(noteLines, L + 2, y + 30, { lineHeightFactor: 1.3 });
  y += nh + 18;
  font(10); doc.text(`ANY QUESTIONS ABOUT THE LOAD OR RATE CALL ${CW.phone}`, (L + R) / 2, y, { align: "center" });

  // Legal
  y += 10;
  font(7.5);
  const legal = doc.splitTextToSize(LEGAL, W - 8);
  const lh = legal.length * 9.5 + 12;
  box(L - 4, y, W + 8, lh);
  doc.text(legal, L + 2, y + 12, { lineHeightFactor: 1.25 });
  y += lh + 22;

  // Signature
  font(8.5, true); doc.text("Carrier Signature", L + 6, y); doc.text("Date", L + 280, y);
  y += 34;
  if (sig) {
    doc.setFont("times", "italic"); doc.setFontSize(18); doc.setTextColor(16, 42, 92);
    doc.text(sig.name, L + 6, y - 6);
    font(9); doc.text(new Date(sig.signedAt).toLocaleDateString("en-US"), L + 280, y - 6);
    ink(); font(7);
    doc.setTextColor(...gray);
    doc.text(`Signed electronically by ${sig.name}${sig.title ? `, ${sig.title}` : ""} on ${new Date(sig.signedAt).toLocaleString("en-US")} for ${r.carrier}`, L + 6, y + 12);
  }
  ink(); doc.setDrawColor(40); doc.setLineWidth(0.6);
  doc.line(L + 6, y, L + 230, y);
  doc.line(L + 280, y, L + 504, y);
  return doc;
}

export function pdfBase64(doc: jsPDF) {
  return doc.output("datauristring").split(",")[1] ?? "";
}
