import { DocLink, useBlobViewer } from "@/components/DocPreview";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Download, FileSignature, FileText, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { applyTrackingFee, buildRateConData, buildRateConPdf, type RateConData } from "@/lib/ratecon";
import { composeEmail, getMailClient } from "@/lib/email";
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
  // Load pay (linehaul + fees) changed elsewhere → drop the stale edit so the rate con reflects it.
  const paySig = `${load.carrier_rate}|${JSON.stringify(load.accessorials ?? [])}`;
  const [draftSig, setDraftSig] = useState<string | null>(null);
  useEffect(() => { setDraft(null); setDraftSig(null); }, [load.id, carrier?.id]);
  useEffect(() => { if (draftSig !== null && draftSig !== paySig) { setDraft(null); setDraftSig(null); } }, [paySig, draftSig]);
  const [ccMe, setCcMe] = useState(true);
  const [tracking, setTracking] = useState(true);
  const [myEmail, setMyEmail] = useState("");
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyEmail(data.user?.email ?? "")); }, []);
  const recipients = () => email.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  const link = (t: string) => `${window.location.origin}/sign/${t}`;
  const current = () => ({ ...load, ship_ref: shipRef || null, dest_ref: destRef || null });

  const saveRefs = async () => {
    if (shipRef === (load.ship_ref ?? "") && destRef === (load.dest_ref ?? "")) return;
    await supabase.from("loads").update({ ship_ref: shipRef || null, dest_ref: destRef || null }).eq("id", load.id);
    onSaved();
  };
  const rcData = () => {
    if (!carrier) throw new Error("Assign a carrier before creating a rate con.");
    const base = buildRateConData({ load: current(), carrier, shipper, consignee, customer });
    return applyTrackingFee(draft ? { ...draft, rc: base.rc, date: base.date, shipRef, destRef } : base, tracking);
  };
  const viewer = useBlobViewer();
  const preview = () => {
    if (!carrier) return;
    viewer.show(buildRateConPdf(rcData()).output("blob"), `RateCon-${load.load_number}.pdf`);
  };
  const openEdit = () => { if (!carrier) return; setWork(applyTrackingFee(rcData(), false)); setEditOpen(true); };
  const saveDraft = async () => {
    if (!work) return;
    const lines = work.lines.filter((l) => l.label.trim());
    const linehaul = lines.find((l) => l.label.trim().toLowerCase() === "linehaul");
    let sig = paySig;
    // Linehaul edits update the load's carrier pay so the money tab, AP and rate con agree.
    if (linehaul && Number(linehaul.amount) !== Number(load.carrier_rate)) {
      const { error } = await supabase.from("loads").update({ carrier_rate: linehaul.amount }).eq("id", load.id);
      if (error) return toast.error(error.message);
      sig = `${linehaul.amount}|${JSON.stringify(load.accessorials ?? [])}`;
      onSaved();
    }
    setDraft({ ...work, lines, total: lines.reduce((a, l) => a + l.amount, 0) });
    setDraftSig(sig);
    setEditOpen(false);
    toast.success("Rate con updated. Send it for signature when ready.");
  };
  const W = <K extends keyof RateConData>(k: K, v: RateConData[K]) => setWork((p) => (p ? { ...p, [k]: v } : p));
  const send = async () => {
    if (!carrier) return;
    if (load.ratecon_signed && !confirm("This rate con is already signed. Send a revised one? The carrier will need to sign the new version; the old signed copy stays on file.")) return;
    await saveRefs();
    await supabase.from("ratecon_requests").update({ status: "void" }).eq("load_id", load.id).eq("status", "sent");
    if (load.ratecon_signed) { await supabase.from("loads").update({ ratecon_signed: false }).eq("id", load.id); onSaved(); }
    const snapshot = rcData();
    const { data, error } = await supabase.from("ratecon_requests").insert({ load_id: load.id, carrier_email: recipients().join(", ") || null, snapshot }).select("token").single();
    if (error) return toast.error(error.message);
    // Keep a copy of exactly what was sent in the load's documents.
    await supabase.storage.from("load-docs").upload(`${load.id}/ratecon-${load.load_number}-sent.pdf`, buildRateConPdf(snapshot).output("blob"), { upsert: true, contentType: "application/pdf" });
    qc.invalidateQueries({ queryKey: ["load-docs", load.id] });
    const url = link(data.token);
    await navigator.clipboard.writeText(url).catch(() => {});
    const to = recipients();
    let direct = false;
    if (to.length) {
      const body = `Please review and sign rate confirmation ${load.load_number} (${snapshot.lane}):\n\n${url}\n\nClearwater Cargo LLC · 252-497-7916`;
      const cc = ccMe && myEmail && !to.includes(myEmail) ? myEmail : undefined;
      direct = await composeEmail(to.join(", "), `Rate Confirmation ${load.load_number} — Clearwater Cargo`, body, getMailClient(), cc);
    }
    toast.success("Signing link copied" + (to.length ? (direct ? ` and emailed to ${to.length} recipient${to.length > 1 ? "s" : ""}${ccMe ? " (copy to you)" : ""}` : " and email drafted") : ""));
    qc.invalidateQueries({ queryKey: key });
  };
  const pending = reqs.find((r) => r.status === "sent");
  const hasSigned = load.ratecon_signed || !!load.ratecon_pdf_path || reqs.some((r) => r.status === "signed");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("Incorrect information");
  const [voidNote, setVoidNote] = useState("");
  const [dropCarrier, setDropCarrier] = useState(false);
  const voidSigned = async () => {
    if (!voidNote.trim()) return toast.error("Add a note explaining why");
    const { data: u } = await supabase.auth.getUser();
    const stamp = { status: "void", void_reason: voidReason, void_note: voidNote.trim(), voided_by: u.user?.id ?? null, voided_at: new Date().toISOString() };
    const { error } = await supabase.from("ratecon_requests").update(stamp).eq("load_id", load.id).in("status", ["signed", "sent"]);
    if (error) return toast.error(error.message);
    const patch: Partial<Load> = { ratecon_signed: false, ratecon_pdf_path: null };
    if (dropCarrier) patch.carrier_id = null;
    const { error: e2 } = await supabase.from("loads").update(patch).eq("id", load.id);
    if (e2) return toast.error(e2.message);
    if (u.user) await supabase.from("load_notes").insert({ load_id: load.id, author_id: u.user.id, body: `Signed rate con deleted — ${voidReason}: ${voidNote.trim()}${dropCarrier && carrier ? ` (carrier ${carrier.legal_name} removed)` : ""}` });
    toast.success(dropCarrier ? "Rate con deleted. Assign the new carrier, then send a new rate con." : "Rate con deleted. Edit it and send the revised version.");
    setVoidOpen(false); setVoidNote(""); setDropCarrier(false); setDraft(null);
    qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["load_notes", load.id] }); onSaved();
  };

  return (
    <>
    {viewer.viewer}
    <div className="mt-4 space-y-2 border-t pt-3">
      <div className="text-xs font-semibold uppercase tracking-widest text-gold">Rate confirmation · RC #{load.load_number}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input placeholder="Ship ref" value={shipRef} onChange={(e) => setShipRef(e.target.value)} onBlur={saveRefs} />
        <Input placeholder="Dest ref" value={destRef} onChange={(e) => setDestRef(e.target.value)} onBlur={saveRefs} />
        <Input placeholder="Carrier emails (separate with commas)" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <label className="flex items-center gap-1"><input type="checkbox" checked={ccMe} onChange={(e) => setCcMe(e.target.checked)} />Send a copy to me{myEmail && ` (${myEmail})`}</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={tracking} onChange={(e) => setTracking(e.target.checked)} />Include $200 tracking fee within agreed rate ($200 deduction if not used)</label>
        {recipients().length > 1 && <span>{recipients().length} recipients</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!carrier} onClick={openEdit}><Pencil className="mr-1 h-3.5 w-3.5" />Edit rate con</Button>
        <Button size="sm" variant="outline" disabled={!carrier} onClick={preview}><FileText className="mr-1 h-3.5 w-3.5" />Preview PDF</Button>
        {draft && <span className="self-center text-[10px] uppercase text-gold">Edited · <button className="underline" onClick={() => setDraft(null)}>reset</button></span>}
        <Button size="sm" disabled={!carrier} onClick={send}>
          <Mail className="mr-1 h-3.5 w-3.5" />{load.ratecon_signed ? "Send revised rate con" : pending ? "Resend for signature" : "Send for signature"}
        </Button>
        {load.ratecon_pdf_path && (
          <DocLink items={[{ name: `RateCon-${load.load_number}-signed.pdf`, bucket: "load-docs", path: load.ratecon_pdf_path }]} className="self-center text-sm"><Download className="mr-1 inline h-3.5 w-3.5" />Signed rate con</DocLink>
        )}
        {hasSigned && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setVoidOpen(true)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete signed rate con</Button>}
      </div>
      <ul className="space-y-1 text-xs">
        {reqs.slice(0, 4).map((r) => (
          <li key={r.id} className="flex items-center justify-between">
            <span>
              <span className={r.status === "signed" ? "text-success" : r.status === "void" ? "text-muted-foreground" : "text-warning"}>
                <FileSignature className="mr-1 inline h-3 w-3" />{r.status === "sent" ? "Awaiting signature" : r.status === "void" && r.void_reason ? "deleted" : r.status}
              </span>{" "}
              · sent {fmtDate(r.created_at)}{r.signed_at && ` · signed by ${r.signer_name} ${fmtDate(r.signed_at)}`}
              {r.void_reason && <span className="block text-muted-foreground">Deleted {fmtDate(r.voided_at)} — {r.void_reason}: {r.void_note}</span>}
            </span>
            {r.status === "sent" && (
              <button className="text-muted-foreground hover:text-foreground" onClick={() => navigator.clipboard.writeText(link(r.token)).then(() => toast.success("Link copied"))}><Copy className="h-3 w-3" /></button>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Delete signed rate con · RC #{load.load_number}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">The signed copy is taken off the load but kept in the history with your reason. You can then send a revised rate con or assign a different carrier.</p>
            <label className="block text-xs">Reason
              <select className="mt-1 h-10 w-full rounded border bg-background px-2" value={voidReason} onChange={(e) => setVoidReason(e.target.value)}>
                {["Incorrect information", "Additional charges", "Rate change", "Carrier fell off / new carrier", "Load cancelled", "Other"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label className="block text-xs">Note (required)<Textarea rows={3} value={voidNote} onChange={(e) => setVoidNote(e.target.value)} placeholder="What changed and why" /></label>
            {carrier && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={dropCarrier} onChange={(e) => setDropCarrier(e.target.checked)} />Remove {carrier.legal_name} from this load so I can assign a new carrier</label>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={voidSigned}>Delete rate con</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Edit rate con · RC #{load.load_number}</DialogTitle></DialogHeader>
          {work && (
            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground">Linehaul changes also update the load's carrier pay. Other edits apply to this rate con only. If carrier pay or fees change on the load later, this rate con refreshes to match.</p>
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
                <div className="mb-1 font-semibold uppercase text-gold">Carrier pay · agreed rates</div>
                {work.lines.map((l, i) => (
                  <div key={i} className="mb-1 flex gap-2">
                    <Input value={l.label} onChange={(e) => W("lines", work.lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Input className="w-32" inputMode="decimal" value={String(l.amount)} onChange={(e) => W("lines", work.lines.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 } : x)))} />
                    <Button size="icon" variant="ghost" onClick={() => W("lines", work.lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => W("lines", [...work.lines, { label: "", amount: 0 }])}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button>
                {tracking && <div className="mt-2 flex justify-between text-muted-foreground"><span>RC linehaul ${applyTrackingFee(work, true).lines.find((line) => line.label.trim().toLowerCase() === "linehaul")?.amount.toFixed(2) ?? "—"}</span><span>Tracking fee $200.00</span></div>}
                <div className="text-right font-semibold">Total ${work.lines.reduce((s2, l) => s2 + l.amount, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
              </div>
              <label className="block">Notes / instructions<Textarea rows={4} value={work.notes} onChange={(e) => W("notes", e.target.value)} /></label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button variant="secondary" onClick={() => viewer.show(buildRateConPdf(applyTrackingFee(work, tracking)).output("blob"), `RateCon-${load.load_number}.pdf`)}>Preview</Button>
                <Button onClick={saveDraft}>Save rate con</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}
