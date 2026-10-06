import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { driversQuery, fleetQuery } from "@/lib/queries";
import type { Load } from "@/lib/tms";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Assign Clearwater's own truck / trailer / driver to a load; keeps fleet availability in sync. */
export function FleetPanel({ load }: { load: Load }) {
  const qc = useQueryClient();
  const { data: units = [] } = useQuery(fleetQuery);
  const { data: drivers = [] } = useQuery(driversQuery);

  const assign = async (key: "truck_id" | "trailer_id" | "driver_id", id: string | null) => {
    const prev = load[key];
    const { error } = await supabase.from("loads").update({ [key]: id } as Partial<Load>).eq("id", load.id);
    if (error) return toast.error(error.message);
    if (key === "driver_id") {
      if (prev) await supabase.from("drivers").update({ status: "available" }).eq("id", prev);
      if (id) await supabase.from("drivers").update({ status: "on_load" }).eq("id", id);
    } else {
      if (prev) await supabase.from("fleet_units").update({ status: "available" }).eq("id", prev);
      if (id) await supabase.from("fleet_units").update({ status: "assigned" }).eq("id", id);
    }
    toast.success(id ? "Fleet assignment saved" : "Unassigned");
    qc.invalidateQueries({ queryKey: ["loads"] });
    qc.invalidateQueries({ queryKey: ["fleet"] });
    qc.invalidateQueries({ queryKey: ["drivers"] });
  };

  const row = (label: string, key: "truck_id" | "trailer_id" | "driver_id", opts: { id: string; label: string; status: string }[], free: string) => (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Select value={load[key] ?? "none"} onValueChange={(v) => assign(key, v === "none" ? null : v)}>
        <SelectTrigger className="h-8 w-60 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {opts.map((o) => (
            <SelectItem key={o.id} value={o.id} disabled={o.status !== free && o.id !== load[key]}>
              {o.label} {o.status !== free && o.id !== load[key] ? `· ${o.status.replace(/_/g, " ")}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div>
      {row("Truck", "truck_id", units.filter((u) => u.kind === "truck").map((u) => ({ id: u.id, label: `${u.unit_number} · ${u.make_model ?? ""}`, status: u.status })), "available")}
      {row("Trailer", "trailer_id", units.filter((u) => u.kind === "trailer").map((u) => ({ id: u.id, label: `${u.unit_number} · ${u.equipment ?? ""}`, status: u.status })), "available")}
      {row("Driver", "driver_id", drivers.map((d) => ({ id: d.id, label: d.full_name, status: d.status })), "available")}
      <p className="mt-2 text-xs text-muted-foreground">Use this when a Clearwater truck hauls the load instead of an outside carrier.</p>
    </div>
  );
}
