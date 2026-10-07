import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Download, FileSignature, FileText, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildRateConData, buildRateConPdf, type RateConData } from "@/lib/ratecon";
import { composeEmail } from "@/lib/email";
import { fmtDate, type Carrier, type Company, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RateConPanel({ load, carrier, shipper, consignee, customer, onSaved }: {
  load: Load; carrier?: Carrier; shipper?: Company; consignee?: Company; customer?: Company; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const key = ["ratecon_requests", load.id];
  const { data: reqs = [] } = useQuery({
    queryKey: key,
    queryFn: async () => (await supabase.from("ratecon_requests").select("*").eq("load_id", load.id).order("created_at", { ascending: false })).data ?? [],
  });
  const [shipRef, setShipRef] = useState(load.ship_ref ?? "");
  const [destRef, setDestRef] = useState(load.dest_ref ?? "");
  const [email, setEmail] = useState(carrier?.email ?? "");
  useEffect(() => { setEmail(carrier?.email ?? ""); }, [carrier?.id, carrier?.email]);
  // Per-rate-con edits; they go into the snapshot the carrier signs, not back onto the load.
  const [draft, setDraft] = useState<RateConData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [work, setWork] = useState<RateConData | null>(null);
  useEffect(() => { setDraft(null); }, [load.id, carrier?.id]);
  const link = (t: string) => `${window.location.origin}/sign/${t}`;
  const current = () => ({ ...load, ship_ref: shipRef || null, dest_ref: destRef || null });

  const saveRefs = async () => {
    if (shipRef === (load.ship_ref ?? "") && destRef === (load.dest_ref ?? "")) return;
    await supabase.from("loads").update({ ship_ref: shipRef || null, dest_ref: destRef || null }).eq("id", load.id);
    onSaved();
  };
  const data = () => {
    const base = buildRateConData({ load: current(), carrier: carrier!, shipper, consignee, customer });
    return draft ? { ...draft, rc: base.rc, date: base.date, shipRef: shipRef, destRef: destRef } : base;
  };
  const preview = () => {
    if (!carrier) return;
    buildRateConPdf(data()).save(`RateCon-${load.load_number}.pdf`);
  };
  const openEdit = () => { if (!carrier) return; setWork(structuredClone(data())); setEditOpen(true); };
  const W = <K extends keyof RateConData>(k: K, v: RateConData[K]) => setWork((p) => (p ? { ...p, [k]: v } : p));
  const send = async () => {
    if (!carrier) return;
    await saveRefs();
    await supabase.from("ratecon_requests").update({ status: "void" }).eq("load_id", load.id).eq("status", "sent");
    const snapshot = data();
    const { data, error } = await supabase.from("ratecon_requests").insert({ load_id: load.id, carrier_email: email || null, snapshot }).select("token").single();
    if (error) return toast.error(error.message);
    const url = link(data.token);
    await navigator.clipboard.writeText(url).catch(() => {});
    if (email) {
      const body = `Please review and sign rate confirmation ${load.load_number} (${snapshot.lane}):\n\n${url}\n\nClearwater Cargo LLC · 252-497-7916`;
      composeEmail(email, `Rate Confirmation ${load.load_number} — Clearwater Cargo`, body);
    }
    toast.success("Signing link copied" + (email ? " and email drafted" : ""));
    qc.invalidateQueries({ queryKey: key });
  };
  const openSigned = async (path: string) => {
    const { data, error } = await supabase.storage.from("load-docs").createSignedUrl(path, 300);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };
  const pending = reqs.find((r) => r.status === "sent");

  return (
    <div className="mt-4 space-y-2 border-t pt-3">
      <div className="text-xs font-semibold uppercase tracking-widest text-gold">Rate confirmation · RC #{load.load_number}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input placeholder="Ship ref" value={shipRef} onChange={(e) => setShipRef(e.target.value)} onBlur={saveRefs} />
        <Input placeholder="Dest ref" value={destRef} onChange={(e) => setDestRef(e.target.value)} onBlur={saveRefs} />
        <Input placeholder="Carrier email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!carrier || load.ratecon_signed} onClick={openEdit}><Pencil className="mr-1 h-3.5 w-3.5" />Edit rate con</Button>
        <Button size="sm" variant="outline" disabled={!carrier} onClick={preview}><FileText className="mr-1 h-3.5 w-3.5" />Preview PDF</Button>
        {draft && <span className="self-center text-[10px] uppercase text-gold">Edited · <button className="underline" onClick={() => setDraft(null)}>reset</button></span>}
        <Button size="sm" disabled={!carrier || load.ratecon_signed} onClick={send}>
          <Mail className="mr-1 h-3.5 w-3.5" />{pending ? "Resend for signature" : "Send for signature"}
        </Button>
        {load.ratecon_pdf_path && (
          <Button size="sm" variant="secondary" onClick={() => openSigned(load.ratecon_pdf_path!)}><Download className="mr-1 h-3.5 w-3.5" />Signed rate con</Button>
        )}
      </div>
      <ul className="space-y-1 text-xs">
        {reqs.slice(0, 4).map((r) => (
          <li key={r.id} className="flex items-center justify-between">
            <span>
              <span className={r.status === "signed" ? "text-success" : r.status === "void" ? "text-muted-foreground" : "text-warning"}>
                <FileSignature className="mr-1 inline h-3 w-3" />{r.status === "sent" ? "Awaiting signature" : r.status}
              </span>{" "}
              · sent {fmtDate(r.created_at)}{r.signed_at && ` · signed by ${r.signer_name} ${fmtDate(r.signed_at)}`}
            </span>
            {r.status === "sent" && (
              <button className="text-muted-foreground hover:text-foreground" onClick={() => navigator.clipboard.writeText(link(r.token)).then(() => toast.success("Link copied"))}><Copy className="h-3 w-3" /></button>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Edit rate con · RC #{load.load_number}</DialogTitle></DialogHeader>
          {work && (
            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground">Changes apply to this rate con only. That's what the carrier sees and signs.</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label>Lane<Input value={work.lane} onChange={(e) => W("lane", e.target.value)} /></label>
                <label>Pickup date<Input value={work.pickup} onChange={(e) => W("pickup", e.target.value)} /></label>
                <label>Delivery date<Input value={work.delivery} onChange={(e) => W("delivery", e.target.value)} /></label>
                <label>Carrier<Input value={work.carrier} onChange={(e) => W("carrier", e.target.value)} /></label>
                <label>MC / DOT<Input value={work.carrierMc} onChange={(e) => W("carrierMc", e.target.value)} /></label>
                <label>Equipment<Input value={work.equipment} onChange={(e) => W("equipment", e.target.value)} /></label>
                <label>Terms<Input value={work.terms} onChange={(e) => W("terms", e.target.value)} /></label>
                <label className="sm:col-span-2">Remit to<Input value={work.remitTo} onChange={(e) => W("remitTo", e.target.value)} /></label>
              </div>
              {(["shipper", "consignee"] as const).map((k) => (
                <div key={k} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <label className="capitalize">{k}<Input value={work[k].name} onChange={(e) => W(k, { ...work[k], name: e.target.value })} /></label>
                  <label>Address<Input value={work[k].addr} onChange={(e) => W(k, { ...work[k], addr: e.target.value })} /></label>
                  <label>City, ST ZIP<Input value={work[k].cityLine} onChange={(e) => W(k, { ...work[k], cityLine: e.target.value })} /></label>
                  <label>Phone<Input value={work[k].phone} onChange={(e) => W(k, { ...work[k], phone: e.target.value })} /></label>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <label className="col-span-2">Commodity<Input value={work.commodity} onChange={(e) => W("commodity", e.target.value)} /></label>
                <label>Weight<Input inputMode="numeric" value={work.weight ?? ""} onChange={(e) => W("weight", e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null)} /></label>
                <label>Qty<Input inputMode="numeric" value={work.qty ?? ""} onChange={(e) => W("qty", e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null)} /></label>
                <label>Hazmat<Input value={work.hazmat} onChange={(e) => W("hazmat", e.target.value)} /></label>
              </div>
              <div>
                <div className="mb-1 font-semibold uppercase text-gold">Carrier pay</div>
                {work.lines.map((l, i) => (
                  <div key={i} className="mb-1 flex gap-2">
                    <Input value={l.label} onChange={(e) => W("lines", work.lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Input className="w-32" inputMode="decimal" value={String(l.amount)} onChange={(e) => W("lines", work.lines.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 } : x)))} />
                    <Button size="icon" variant="ghost" onClick={() => W("lines", work.lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => W("lines", [...work.lines, { label: "", amount: 0 }])}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button>
                <div className="text-right font-semibold">Total ${work.lines.reduce((s2, l) => s2 + l.amount, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
              </div>
              <label className="block">Notes / instructions<Textarea rows={4} value={work.notes} onChange={(e) => W("notes", e.target.value)} /></label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button variant="secondary" onClick={() => buildRateConPdf({ ...work, total: work.lines.reduce((a, l) => a + l.amount, 0) }).save(`RateCon-${load.load_number}.pdf`)}>Preview</Button>
                <Button onClick={() => { setDraft({ ...work, lines: work.lines.filter((l) => l.label.trim()), total: work.lines.filter((l) => l.label.trim()).reduce((a, l) => a + l.amount, 0) }); setEditOpen(false); toast.success("Rate con updated. Send it for signature when ready."); }}>Save rate con</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
