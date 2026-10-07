import { useState } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { carrierCompliance, type Carrier } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityCombobox, type ComboValue } from "@/components/EntityCombobox";
import { draftInviteEmail } from "@/components/CarrierOnboarding";

/** Type-to-search carrier assignment; unknown carriers get added as pending and sent a packet invite. */
export function CarrierPicker({ carriers, currentId, onPick, onAdded }: {
  carriers: Carrier[]; currentId: string | null; onPick: (id: string | null) => void; onAdded: () => void;
}) {
  const cur = carriers.find((c) => c.id === currentId);
  const [v, setV] = useState<ComboValue>({ id: cur?.id ?? null, name: cur?.legal_name ?? "" });
  const [mc, setMc] = useState("");
  const [email, setEmail] = useState("");
  const isNew = !v.id && v.name.trim().length > 1;

  const addAndInvite = async () => {
    const { data: c, error } = await supabase.from("carriers")
      .insert({ legal_name: v.name.trim(), mc_number: mc || null, email: email || null, status: "pending" })
      .select("id").single();
    if (error) return toast.error(error.message);
    const { data: inv, error: e2 } = await supabase.from("carrier_invites").insert({ carrier_id: c.id, email: email || null }).select("token").single();
    if (e2) return toast.error(e2.message);
    draftInviteEmail(inv.token, email, v.name.trim());
    toast.success("Carrier added as pending — they can be booked once their packet is in and you mark them vetted");
    onAdded();
    setV({ id: null, name: "" }); setMc(""); setEmail("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <EntityCombobox
            value={v}
            placeholder="Type carrier name or MC#"
            newLabel="new carrier (pending)"
            options={carriers.map((c) => {
              const cc = carrierCompliance(c); const ok = cc.ok;
              return { id: c.id, label: c.legal_name, search: `${c.mc_number ?? ""} ${c.dot_number ?? ""} ${c.dba ?? ""}`, disabled: !ok,
                sub: `MC ${c.mc_number ?? "—"} · ${c.status === "dnu" ? "⛔ Do not use" : cc.conditional ? `◐ Conditional until ${c.conditional_until} — docs pending` : ok ? "✓ Compliant" : "⚠ Not compliant — finish vetting"}` };
            })}
            onChange={(nv) => { setV(nv); if (nv.id) onPick(nv.id); }}
          />
        </div>
        {currentId && <Button size="sm" variant="ghost" onClick={() => { setV({ id: null, name: "" }); onPick(null); }}>Clear</Button>}
      </div>
      {isNew && (
        <div className="space-y-2 rounded border border-warning/50 bg-warning/5 p-2">
          <div className="text-xs text-muted-foreground">Not in the system. Add them and send the onboarding packet:</div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="MC #" value={mc} onChange={(e) => setMc(e.target.value)} />
            <Input placeholder="Carrier email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button size="sm" onClick={addAndInvite}><Mail className="mr-1 h-3.5 w-3.5" />Add carrier & email packet invite</Button>
        </div>
      )}
    </div>
  );
}
