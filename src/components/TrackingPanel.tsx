import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Mail, MapPin, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { composeEmail } from "@/lib/email";
import { fmtDate, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TrackingPanel({ load }: { load: Load }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const { data: tokens = [] } = useQuery({
    queryKey: ["tracking_tokens", load.id],
    queryFn: async () =>
      (await supabase.from("load_tracking_tokens").select("*").eq("load_id", load.id).order("created_at", { ascending: false })).data ?? [],
  });
  const { data: pings = [] } = useQuery({
    queryKey: ["tracking_pings", load.id],
    queryFn: async () =>
      (await supabase.from("load_tracking_pings").select("*").eq("load_id", load.id).order("created_at", { ascending: false }).limit(20)).data ?? [],
  });
  const active = tokens.find((t) => t.status === "active" && new Date(t.expires_at) > new Date());
  const link = active ? `${window.location.origin}/track/${active.token}` : null;

  const create = async () => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("load_tracking_tokens").insert({
      load_id: load.id,
      driver_name: name || null,
      driver_phone: phone || null,
      created_by: u.user?.id,
    });
    if (error) return toast.error(error.message);
    toast.success("Tracking link created");
    qc.invalidateQueries({ queryKey: ["tracking_tokens", load.id] });
  };
  const copy = () => { if (link) { navigator.clipboard.writeText(link); toast.success("Link copied — text it to the driver"); } };
  const email = () => {
    if (!link) return;
    composeEmail(
      "",
      `Clearwater Cargo — tracking for load ${load.load_number}`,
      `Hello${active?.driver_name ? ` ${active.driver_name}` : ""},\n\nPlease use this private link to send status updates, your location, and photos of the signed POD/BOL for load ${load.load_number} (${load.origin_city}, ${load.origin_state} → ${load.dest_city}, ${load.dest_state}):\n\n${link}\n\nNo app or login needed — just open it on your phone.\n\nThank you,\nClearwater Cargo`,
    );
  };
  const revoke = async (id: string) => {
    await supabase.from("load_tracking_tokens").update({ status: "void" }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["tracking_tokens", load.id] });
  };

  return (
    <div className="space-y-3 text-sm">
      {!active ? (
        <div className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Driver name (optional)" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Driver phone (optional)" />
          <Button size="sm" onClick={create}>Create tracking link</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="break-all rounded border bg-background p-2 font-mono text-xs">{link}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={copy}><Copy className="mr-1 h-3.5 w-3.5" />Copy link</Button>
            <Button size="sm" variant="outline" onClick={email}><Mail className="mr-1 h-3.5 w-3.5" />Email</Button>
            <Button size="sm" variant="ghost" onClick={() => revoke(active.id)}><Ban className="mr-1 h-3.5 w-3.5" />Revoke</Button>
          </div>
          {active.driver_name && <div className="text-xs text-muted-foreground">Driver: {active.driver_name}{active.driver_phone ? ` · ${active.driver_phone}` : ""}</div>}
        </div>
      )}
      {pings.length > 0 && (
        <div className="space-y-1 border-t pt-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Driver updates</div>
          {pings.map((p) => (
            <div key={p.id} className="flex items-start gap-2 text-xs">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-gold" />
              <div>
                <span className="font-medium">{p.kind === "status" ? p.status : "Location"}</span>
                {p.note ? ` — ${p.note}` : ""}
                {p.lat != null && (
                  <a className="ml-1 text-gold underline" target="_blank" rel="noreferrer"
                    href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}>map</a>
                )}
                <div className="text-muted-foreground">{fmtDate(p.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
