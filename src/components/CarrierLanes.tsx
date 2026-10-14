import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usd, fmtDate, type Load } from "@/lib/tms";
import { laneHistoryQuery } from "@/lib/queries";
import { LoadQuickLook } from "@/components/LoadQuickLook";

const RUN = ["delivered", "invoiced", "paid", "rolling", "dispatched"];

export function CarrierLanes({ carrierId }: { carrierId: string }) {
  const { data: hist = [] } = useQuery(laneHistoryQuery(carrierId));
  const [openLane, setOpenLane] = useState<string | null>(null);
  const lanes = useMemo(() => {
    const m = new Map<string, Load[]>();
    hist.filter((l) => RUN.includes(l.status)).forEach((l) => {
      const k = `${l.origin_city}|${l.origin_state}|${l.dest_city}|${l.dest_state}|${l.equipment}`;
      m.set(k, [...(m.get(k) ?? []), l]);
    });
    return [...m.entries()].map(([key, ls]) => {
      const f = ls[0]!;
      const rpm = ls.filter((l) => (l.miles ?? 0) > 0).map((l) => Number(l.carrier_rate) / l.miles!);
      const sorted = [...ls].sort((a, b) => (b.pickup_at ?? b.created_at).localeCompare(a.pickup_at ?? a.created_at));
      return { key, origin_city: f.origin_city, origin_state: f.origin_state, dest_city: f.dest_city, dest_state: f.dest_state, equipment: f.equipment,
        runs: ls.length, avg_rate: ls.reduce((s, l) => s + Number(l.carrier_rate), 0) / ls.length,
        avg_rpm: rpm.length ? rpm.reduce((a, b) => a + b, 0) / rpm.length : null, last_run: sorted[0]!.pickup_at ?? sorted[0]!.created_at, loads: sorted };
    }).sort((a, b) => b.runs - a.runs);
  }, [hist]);
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
        <div className="overflow-x-auto"><table className="min-w-[600px] text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th>Lane</th><th>Equip</th><th className="text-right">Runs</th><th className="text-right">Avg pay</th><th className="text-right">$/mi</th><th className="text-right">Last</th></tr>
          </thead>
          <tbody>
            {lanes.map((l) => (<>
              <tr key={l.key} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setOpenLane(openLane === l.key ? null : l.key)}>
                <td className="text-gold underline-offset-2 hover:underline">{openLane === l.key ? "▾" : "▸"} {l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}</td>
                <td>{l.equipment}</td>
                <td className="text-right">{l.runs}</td>
                <td className="text-right">{usd(Number(l.avg_rate))}</td>
                <td className="text-right">{l.avg_rpm ? `$${Number(l.avg_rpm).toFixed(2)}` : "—"}</td>
                <td className="text-right">{l.last_run ? new Date(l.last_run).toLocaleDateString() : "—"}</td>
              </tr>
              {openLane === l.key && (
                <tr key={l.key + "-loads"}><td colSpan={6} className="bg-muted/20 px-3 py-2">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {l.loads.map((x) => (
                      <span key={x.id} className="text-xs"><LoadQuickLook load={x} /> · {fmtDate(x.pickup_at)} · {usd(Number(x.carrier_rate))}</span>
                    ))}
                  </div>
                </td></tr>
              )}
            </>))}
          </tbody>
        </table></div>
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
