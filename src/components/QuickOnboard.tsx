import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Mail, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FmcsaButton, FmcsaSummary } from "@/components/FmcsaLookup";
import { draftInviteEmail } from "@/components/CarrierOnboarding";
import type { FmcsaCarrier } from "@/lib/fmcsa.functions";

/** Onboard a carrier from any screen: MC/DOT → FMCSA → send packet link. Always opens blank. */
export function QuickOnboardButton({ className, label = "Onboard carrier" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className={className} onClick={() => setOpen(true)}><UserPlus className="mr-1 h-4 w-4" />{label}</Button>
      {open && <QuickOnboardDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

export function QuickOnboardDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [mc, setMc] = useState("");
  const [dot, setDot] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [fm, setFm] = useState<FmcsaCarrier | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setMc(""); setDot(""); setEmail(""); setName(""); setFm(null); } }, [open]);

  const fill = (r: FmcsaCarrier) => {
    setFm(r);
    setName(r.legal_name ?? "");
    setMc(r.mc_number ?? mc); setDot(r.dot_number ?? dot);
    if (!email && r.email) setEmail(r.email);
  };

  const send = async (mail: boolean) => {
    if (!name.trim() || (!mc && !dot)) return toast.error("Look up the MC or DOT first (or type the legal name and MC/DOT)");
    setBusy(true);
    try {
      let q = supabase.from("carriers").select("id, legal_name");
      q = dot ? q.eq("dot_number", dot) : q.eq("mc_number", mc);
      const { data: existing } = await q.limit(1).maybeSingle();
      let id = existing?.id;
      if (!id) {
        const { data, error } = await supabase.from("carriers").insert({
          legal_name: name.trim(), mc_number: mc || null, dot_number: dot || null, email: email || null, status: "pending",
          ...(fm ? { dba: fm.dba, address: fm.address, city: fm.city, state: fm.state, zip: fm.zip, phone: fm.phone ?? fm.cell_phone, contact_name: fm.contact_name, authority_status: fm.authority_status, safety_rating: fm.safety_rating } : {}),
        }).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      const { data: inv, error: e2 } = await supabase.from("carrier_invites").insert({ carrier_id: id, email: email || null }).select("token").single();
      if (e2) throw e2;
      if (mail) draftInviteEmail(inv.token, email, name.trim());
      else await navigator.clipboard.writeText(`${window.location.origin}/onboard/${inv.token}`).catch(() => {});
      toast.success(`${existing ? `${existing.legal_name} is already saved — ` : `${name.trim()} added as pending — `}${mail ? "packet email drafted" : "packet link copied"}`);
      qc.invalidateQueries({ queryKey: ["carriers"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't onboard the carrier");
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Onboard a carrier</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">1. Enter the MC # or DOT # and pull from FMCSA. 2. Add the carrier's email. 3. Send the packet link — they're added as pending until vetted.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">MC #<Input className="mt-1" value={mc} onChange={(e) => setMc(e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">DOT #<Input className="mt-1" value={dot} onChange={(e) => setDot(e.target.value)} /></label>
        </div>
        <FmcsaButton mc={mc} dot={dot} onResult={fill} />
        {fm && <FmcsaSummary r={fm} />}
        <label className="text-xs text-muted-foreground">Legal name<Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-xs text-muted-foreground">Carrier email<Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => send(false)}><Link2 className="mr-1 h-4 w-4" />Copy link</Button>
          <Button disabled={busy} onClick={() => send(true)}><Mail className="mr-1 h-4 w-4" />Email packet</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
