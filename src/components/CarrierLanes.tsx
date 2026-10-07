import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usd } from "@/lib/tms";

export function CarrierLanes({ carrierId }: { carrierId: string }) {
  const { data: lanes = [] } = useQuery({
    queryKey: ["carrier-lanes", carrierId],
    queryFn: async () => (await supabase.from("carrier_lane_history").select("*").eq("carrier_id", carrierId).order("runs", { ascending: false })).data ?? [],
  });
  const { data: interest = [] } = useQuery({
    queryKey: ["carrier-interest", carrierId],
    queryFn: async () =>
      (await supabase.from("load_offers").select("status, counter_rate, offered_rate, responded_at, loads(origin_city, origin_state, dest_city, dest_state, equipment)")
        .eq("carrier_id", carrierId).in("status", ["accepted", "countered"]).order("responded_at", { ascending: false }).limit(20)).data ?? [],
  });
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-wider text-gold">Lanes run</h3>
      {lanes.length === 0 ? <p className="text-sm text-muted-foreground">No loads hauled for Clearwater yet.</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th>Lane</th><th>Equip</th><th className="text-right">Runs</th><th className="text-right">Avg pay</th><th className="text-right">$/mi</th><th className="text-right">Last</th></tr>
          </thead>
          <tbody>
            {lanes.map((l, i) => (
              <tr key={i} className="border-t">
                <td>{l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</td>
                <td>{l.equipment}</td>
                <td className="text-right">{l.runs}</td>
                <td className="text-right">{usd(Number(l.avg_rate))}</td>
                <td className="text-right">{l.avg_rpm ? `$${Number(l.avg_rpm).toFixed(2)}` : "—"}</td>
                <td className="text-right">{l.last_run ? new Date(l.last_run).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {interest.length > 0 && (
        <div className="mt-3">
          <div className="text-xs uppercase text-muted-foreground">Interested in lane (offer responses)</div>
          {interest.map((o, i) => {
            const l = o.loads as { origin_city: string; origin_state: string; dest_city: string; dest_state: string; equipment: string } | null;
            return l ? (
              <div key={i} className="text-sm">
                {l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state} · {l.equipment} · <span className="capitalize">{o.status}</span> {usd(Number(o.counter_rate ?? o.offered_rate))}
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
