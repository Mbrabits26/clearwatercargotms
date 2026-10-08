import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/tms";

export function SignatureRecords({ carrierId }: { carrierId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["carrier_signatures", carrierId],
    queryFn: async () => (await supabase.from("carrier_signatures").select("*").eq("carrier_id", carrierId).order("signed_at", { ascending: false })).data ?? [],
  });
  if (!data.length) return null;
  return (
    <div className="rounded border bg-card p-4 text-sm">
      <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold uppercase tracking-widest text-gold"><ShieldCheck className="h-4 w-4" />Signed online</h3>
      {data.map((s) => (
        <div key={s.id} className="grid grid-cols-1 gap-x-4 text-xs sm:grid-cols-2">
          <span>Signer: <b>{s.signer_name ?? "—"}</b>{s.signer_title ? `, ${s.signer_title}` : ""}</span>
          <span>Signed: {fmtDate(s.signed_at)} {s.signed_at && new Date(s.signed_at).toLocaleTimeString()}</span>
          <span>IP address: {s.signer_ip ?? "—"}</span>
          <span>Reference: {s.external_ref}</span>
          <span className="sm:col-span-2 truncate text-muted-foreground">Device: {s.user_agent ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}
