import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtMin } from "@/lib/eld";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Unit = { id: string; unit_number: string; kind: string };
type Drv = { id: string; full_name: string };

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Latest Core ELD position + hours for each truck (fed by the ELD push endpoint). */
export function EldLive({ units, drivers }: { units: Unit[]; drivers: Drv[] }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["eld_positions"],
    refetchInterval: 60_000,
    queryFn: async () => (await supabase.from("eld_positions").select("*").order("recorded_at", { ascending: false }).limit(500)).data ?? [],
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) { const k = r.unit_id ?? `?${r.eld_unit}`; if (!latest.has(k)) latest.set(k, r); }
  const list = [...latest.values()];
  return (
    <div>
      <Table>
        <TableHeader><TableRow><TableHead>Truck</TableHead><TableHead>Driver</TableHead><TableHead>Duty</TableHead><TableHead>Drive left</TableHead><TableHead>Shift left</TableHead><TableHead>Cycle left</TableHead><TableHead>Speed</TableHead><TableHead>Location</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
        <TableBody>
          {list.map((r) => {
            const u = units.find((x) => x.id === r.unit_id);
            const d = drivers.find((x) => x.id === r.driver_id);
            const stale = Date.now() - new Date(r.recorded_at).getTime() > 30 * 60000;
            return (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-gold">{u?.unit_number ?? <span className="text-warning">{r.eld_unit} (not matched)</span>}</TableCell>
                <TableCell>{d?.full_name ?? r.eld_driver ?? "—"}</TableCell>
                <TableCell className="capitalize">{r.duty_status?.replace(/_/g, " ") ?? "—"}</TableCell>
                <TableCell className={r.drive_left_min != null && r.drive_left_min < 60 ? "text-destructive" : ""}>{fmtMin(r.drive_left_min)}</TableCell>
                <TableCell>{fmtMin(r.shift_left_min)}</TableCell>
                <TableCell>{fmtMin(r.cycle_left_min)}</TableCell>
                <TableCell>{r.speed_mph != null ? `${Math.round(Number(r.speed_mph))} mph` : "—"}</TableCell>
                <TableCell>{r.lat != null && r.lng != null
                  ? <a className="inline-flex items-center gap-1 text-primary underline" href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer"><MapPin className="h-3 w-3" />Map</a>
                  : "—"}</TableCell>
                <TableCell className={stale ? "text-warning" : "text-muted-foreground"}>{ago(r.recorded_at)}</TableCell>
              </TableRow>
            );
          })}
          {!list.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No ELD data yet. Once Core ELD starts sending, each truck's location and hours show here.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <p className="p-3 text-xs text-muted-foreground">Trucks are matched to Core ELD by unit number. Refreshes every minute; amber means no update in 30+ minutes.</p>
    </div>
  );
}
