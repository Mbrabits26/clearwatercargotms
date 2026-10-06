import { jsPDF } from "jspdf";
import logo from "@/assets/clearwater-logo.jpg.asset.json";
import { type Accessorial, type Carrier, type Company, type Load, usd, fmtDate } from "./tms";

async function logoData(): Promise<string | null> {
  try {
    const blob = await (await fetch(logo.url)).blob();
    return await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateRateCon(opts: {
  load: Load;
  carrier: Carrier;
  shipper?: Company;
  consignee?: Company;
  brokerName: string;
}) {
  const { load, carrier, shipper, consignee, brokerName } = opts;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const img = await logoData();
  doc.setFillColor(20, 24, 28);
  doc.rect(0, 0, W, 96, "F");
  if (img) doc.addImage(img, "JPEG", 36, 12, 90, 72);
  doc.setTextColor(214, 168, 72);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("RATE CONFIRMATION", W - 36, 44, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(230, 230, 230);
  doc.text(`Load ${load.load_number}  ·  Issued ${new Date().toLocaleDateString()}`, W - 36, 62, { align: "right" });
  doc.text("Clearwater Cargo, LLC · Staley, NC", W - 36, 76, { align: "right" });

  doc.setTextColor(20, 20, 20);
  let y = 126;
  const section = (title: string) => {
    doc.setFillColor(28, 84, 92);
    doc.rect(36, y - 12, W - 72, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(title, 42, y);
    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "normal");
    y += 20;
  };
  const line = (k: string, v: string) => {
    doc.setFont("helvetica", "bold");
    doc.text(k, 42, y);
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(v || "—", W - 200);
    doc.text(wrapped, 170, y);
    y += 14 * wrapped.length;
  };

  section("CARRIER");
  line("Carrier", `${carrier.legal_name}${carrier.dba ? ` (DBA ${carrier.dba})` : ""}`);
  line("MC / DOT", `MC ${carrier.mc_number ?? "—"} / DOT ${carrier.dot_number ?? "—"}`);
  line("Remit to", carrier.factoring_company ? `${carrier.factoring_company} (NOA on file)` : carrier.legal_name);
  y += 6;
  section("PICKUP");
  line("Shipper", shipper ? `${shipper.name}, ${shipper.address ?? ""} ${shipper.city ?? ""}, ${shipper.state ?? ""} ${shipper.zip ?? ""}` : `${load.origin_city}, ${load.origin_state}`);
  line("Appointment", fmtDate(load.pickup_at));
  line("Instructions", load.pickup_notes ?? "");
  y += 6;
  section("DELIVERY");
  line("Consignee", consignee ? `${consignee.name}, ${consignee.address ?? ""} ${consignee.city ?? ""}, ${consignee.state ?? ""} ${consignee.zip ?? ""}` : `${load.dest_city}, ${load.dest_state}`);
  line("Appointment", fmtDate(load.delivery_at));
  line("Instructions", load.delivery_notes ?? "");
  y += 6;
  section("FREIGHT");
  line("Equipment", load.equipment);
  line("Commodity", load.commodity ?? "");
  line("Weight / Pieces", `${load.weight_lbs?.toLocaleString() ?? "—"} lbs / ${load.pieces ?? "—"} pcs`);
  if (load.temperature) line("Temperature", load.temperature);
  y += 6;
  section("CARRIER PAY");
  line("Linehaul", usd(Number(load.carrier_rate)));
  const acc = (load.accessorials as Accessorial[]) ?? [];
  acc.forEach((a) => line(a.type, usd(Number(a.amount))));
  const total = Number(load.carrier_rate) + acc.reduce((s, a) => s + Number(a.amount), 0);
  doc.setFontSize(12);
  line("TOTAL", usd(total));
  doc.setFontSize(10);
  y += 10;
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.text(
    doc.splitTextToSize(
      "Carrier agrees to transport the above shipment under the terms of the Broker-Carrier Agreement on file. Re-brokering, co-brokering or double-brokering is strictly prohibited and voids payment. Signed POD and this rate confirmation are required for payment. Check calls required every 4 hours while in transit.",
      W - 72,
    ),
    36,
    y,
  );
  y += 50;
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(10);
  doc.line(36, y, 260, y);
  doc.line(W - 260, y, W - 36, y);
  doc.text(`Broker: ${brokerName}`, 36, y + 14);
  doc.text("Carrier signature / date", W - 260, y + 14);
  doc.save(`RateCon-${load.load_number}.pdf`);
}
