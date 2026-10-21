import { useState } from "react";
import { jsPDF } from "jspdf";
import { FileText, Download, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DocViewer, type DocItem } from "@/components/DocPreview";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CW } from "@/lib/ratecon";
import type { Carrier, Company, Load } from "@/lib/tms";

type B = Record<string, string>;
const addr = (c?: Company) => (c ? [c.address, [c.city, c.state, c.zip].filter(Boolean).join(", ")].filter(Boolean).join("\n") : "");
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US") : "");

/** Bill of lading: freight/party details only — never rates, linehaul or pay. */
function initial(load: Load, shipper?: Company, consignee?: Company, carrier?: Carrier): B {
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    bol: load.load_number, date: new Date().toLocaleDateString("en-US"),
    shipper: shipper?.name ?? "", shipper_addr: addr(shipper) || `${load.origin_city}, ${load.origin_state}`, shipper_phone: s(shipper?.phone ?? shipper?.contact_name),
    consignee: consignee?.name ?? "", consignee_addr: addr(consignee) || `${load.dest_city}, ${load.dest_state}`, consignee_phone: s(consignee?.phone ?? consignee?.contact_name),
    bill_to: `${CW.name}\n${CW.addr1}\n${CW.addr2}\n${CW.phone}`,
    carrier: carrier?.legal_name ?? "", carrier_ids: [carrier?.mc_number && `MC ${carrier.mc_number}`, carrier?.dot_number && `DOT ${carrier.dot_number}`].filter(Boolean).join(" · "),
    trailer: "", seal: "", pickup: day(load.pickup_at), delivery: day(load.delivery_at),
    ship_ref: s(load.ship_ref), dest_ref: s(load.dest_ref), po: "",
    pieces: s(load.pieces), commodity: s(load.commodity), weight: s(load.weight_lbs), equipment: load.equipment, temp: s(load.temperature), hazmat: "No",
    instructions: [load.pickup_notes && `Pickup: ${load.pickup_notes}`, load.delivery_notes && `Delivery: ${load.delivery_notes}`].filter(Boolean).join("\n"),
  };
}

function buildBolPdf(b: B) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const L = 40, R = 572, W = R - L;
  doc.setFont("helvetica", "bold").setFontSize(20).text("BILL OF LADING", L, 56);
  doc.setFont("helvetica", "normal").setFontSize(9).text([`BOL #: ${b.bol}`, `Date: ${b.date}`], R, 48, { align: "right" });
  const box = (x: number, y: number, w: number, h: number, title: string, body: string) => {
    doc.setDrawColor(150).rect(x, y, w, h);
    doc.setFillColor(15, 61, 62).rect(x, y, w, 14, "F");
    doc.setTextColor(255).setFont("helvetica", "bold").setFontSize(8).text(title, x + 4, y + 10);
    doc.setTextColor(0).setFont("helvetica", "normal").setFontSize(9).text(doc.splitTextToSize(body || " ", w - 8), x + 4, y + 26);
  };
  let y = 100; const half = W / 2;
  box(L, y, half, 80, "SHIP FROM (SHIPPER)", [b.shipper, b.shipper_addr, b.shipper_phone].filter(Boolean).join("\n"));
  box(L + half, y, half, 80, "SHIP TO (CONSIGNEE)", [b.consignee, b.consignee_addr, b.consignee_phone].filter(Boolean).join("\n"));
  y += 80;
  box(L, y, half, 70, "THIRD PARTY FREIGHT CHARGES BILL TO", b.bill_to ?? "");
  box(L + half, y, half, 70, "CARRIER", [b.carrier, b.carrier_ids, b.trailer && `Trailer #: ${b.trailer}`, b.seal && `Seal #: ${b.seal}`].filter(Boolean).join("\n"));
  y += 70;
  const q = W / 4;
  box(L, y, q, 40, "PICKUP DATE", b.pickup ?? ""); box(L + q, y, q, 40, "DELIVERY DATE", b.delivery ?? "");
  box(L + 2 * q, y, q, 40, "SHIPPER PO / PU REF #", b.ship_ref ?? ""); box(L + 3 * q, y, q, 40, "PO / DELIVERY REF", [b.po, b.dest_ref].filter(Boolean).join(" / "));
  y += 54;
  const cols = [["PIECES", 60], ["DESCRIPTION OF ARTICLES", 222], ["WEIGHT (LBS)", 80], ["EQUIPMENT", 80], ["TEMP", 50], ["HM", 40]] as const;
  doc.setFillColor(15, 61, 62).rect(L, y, W, 16, "F");
  let x = L; doc.setTextColor(255).setFont("helvetica", "bold").setFontSize(8);
  for (const [t, w] of cols) { doc.text(t, x + 4, y + 11); x += w; }
  doc.setTextColor(0).setFont("helvetica", "normal").setFontSize(9);
  const vals = [b.pieces, b.commodity, b.weight, b.equipment, b.temp, b.hazmat];
  x = L; const desc = doc.splitTextToSize(b.commodity || " ", 214) as string[]; const rh = Math.max(22, desc.length * 11 + 10);
  cols.forEach(([, w], i) => { doc.rect(x, y + 16, w, rh); doc.text(i === 1 ? desc : String(vals[i] ?? ""), x + 4, y + 30); x += w; });
  y += 16 + rh + 10;
  box(L, y, W, 90, "SPECIAL INSTRUCTIONS", b.instructions ?? "");
  y += 104;
  doc.setFontSize(7).text(doc.splitTextToSize("Received, subject to the classifications and tariffs in effect on the date of issue, the property described above in apparent good order, except as noted. The carrier agrees to deliver to the consignee at the destination. Shipper certifies that the contents are properly classified, packaged, marked and labeled.", W), L, y);
  y += 40;
  const sig = (sx: number, label: string) => { doc.line(sx, y + 30, sx + 160, y + 30); doc.setFontSize(8).text([label, "Signature / Date"], sx, y + 42); };
  sig(L, "SHIPPER"); sig(L + 186, "CARRIER / DRIVER"); sig(L + 372, "CONSIGNEE (RECEIVED BY)");
  doc.text("Pieces received: ______   Exceptions: ________________________________", L, y + 80);
  return doc;
}

const FIELDS: [string, string, boolean?][] = [
  ["bol", "BOL #"], ["date", "Date"], ["shipper", "Shipper"], ["shipper_phone", "Shipper phone / contact"], ["shipper_addr", "Shipper address", true],
  ["consignee", "Consignee"], ["consignee_phone", "Consignee phone / contact"], ["consignee_addr", "Consignee address", true],
  ["bill_to", "Freight charges bill to", true], ["carrier", "Carrier"], ["carrier_ids", "Carrier MC / DOT"], ["trailer", "Trailer #"], ["seal", "Seal #"],
  ["pickup", "Pickup date"], ["delivery", "Delivery date"], ["ship_ref", "Shipper PO / PU Ref #"], ["dest_ref", "Delivery ref / appt #"], ["po", "PO #"],
  ["pieces", "Pieces"], ["weight", "Weight (lbs)"], ["equipment", "Equipment"], ["temp", "Temperature"], ["hazmat", "Hazmat (Yes/No)"],
  ["commodity", "Description of articles", true], ["instructions", "Special instructions", true],
];

export function BolDialog({ load, shipper, consignee, carrier }: { load: Load; shipper?: Company; consignee?: Company; carrier?: Carrier }) {
  const [open, setOpen] = useState(false);
  const [b, setB] = useState<B>({});
  const [view, setView] = useState<DocItem[] | null>(null);
  const qc = useQueryClient();
  const start = () => { setB(initial(load, shipper, consignee, carrier)); setOpen(true); };
  const name = () => `BOL-${b.bol || load.load_number}.pdf`;
  // Every created BOL is kept in the load's documents (latest version replaces the previous one).
  const store = async (blob: Blob) => {
    const { error } = await supabase.storage.from("load-docs").upload(`${load.id}/bol-${load.load_number}.pdf`, blob, { upsert: true, contentType: "application/pdf" });
    if (error) return toast.error(`Couldn't save to load documents: ${error.message}`);
    qc.invalidateQueries({ queryKey: ["load-docs", load.id] });
  };
  const preview = async () => { const blob = buildBolPdf(b).output("blob"); setView([{ name: name(), blob }]); await store(blob); };
  const download = async () => { const d = buildBolPdf(b); d.save(name()); await store(d.output("blob")); toast.success("BOL saved to the load's documents"); };
  return (
    <>
      <Button size="sm" variant="outline" onClick={start}><FileText className="mr-1 h-3.5 w-3.5" />Create BOL</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Bill of lading · {load.load_number}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Filled in from the load. Edit anything before you preview or download. No rates or pay are printed on the BOL.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map(([k, label, multi]) => (
              <label key={k} className={multi ? "block text-xs text-muted-foreground sm:col-span-2" : "block text-xs text-muted-foreground"}>{label}
                {multi
                  ? <Textarea className="mt-1" rows={3} value={b[k] ?? ""} onChange={(e) => setB((p) => ({ ...p, [k]: e.target.value }))} />
                  : <Input className="mt-1" value={b[k] ?? ""} onChange={(e) => setB((p) => ({ ...p, [k]: e.target.value }))} />}
              </label>
            ))}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setB(initial(load, shipper, consignee, carrier))}>Reset from load</Button>
            <Button variant="secondary" onClick={preview}><Eye className="mr-1 h-4 w-4" />Preview</Button>
            <Button onClick={download}><Download className="mr-1 h-4 w-4" />Download PDF</Button>
          </div>
        </DialogContent>
      </Dialog>
      {view && <DocViewer items={view} index={0} onClose={() => setView(null)} />}
    </>
  );
}
