import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Download, FileSignature, FileText, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildRateConData, buildRateConPdf } from "@/lib/ratecon";
import { composeEmail } from "@/lib/email";
import { fmtDate, type Carrier, type Company, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const link = (t: string) => `${window.location.origin}/sign/${t}`;
  const current = () => ({ ...load, ship_ref: shipRef || null, dest_ref: destRef || null });

  const saveRefs = async () => {
    if (shipRef === (load.ship_ref ?? "") && destRef === (load.dest_ref ?? "")) return;
    await supabase.from("loads").update({ ship_ref: shipRef || null, dest_ref: destRef || null }).eq("id", load.id);
    onSaved();
  };
  const preview = () => {
    if (!carrier) return;
    buildRateConPdf(buildRateConData({ load: current(), carrier, shipper, consignee, customer })).save(`RateCon-${load.load_number}.pdf`);
  };
  const send = async () => {
    if (!carrier) return;
    await saveRefs();
    await supabase.from("ratecon_requests").update({ status: "void" }).eq("load_id", load.id).eq("status", "sent");
    const snapshot = buildRateConData({ load: current(), carrier, shipper, consignee, customer });
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
        <Button size="sm" variant="outline" disabled={!carrier} onClick={preview}><FileText className="mr-1 h-3.5 w-3.5" />Preview PDF</Button>
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
    </div>
  );
}
