import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { carriersQuery, companiesQuery, driversQuery, fleetQuery, loadsQuery } from "@/lib/queries";
import { LoadQuickLook } from "@/components/LoadQuickLook";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { ACTIVE_STATUSES, DRIVER_STATUSES, UNIT_STATUSES, fmtDate, type Load } from "@/lib/tms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/fleet")({
  head: () => ({
    meta: [
      { title: "Internal Fleet — Clearwater Cargo TMS" },
      { name: "description", content: "Clearwater Cargo trucks, trailers and drivers with availability and assignments." },
      { property: "og:title", content: "Internal Fleet — Clearwater Cargo TMS" },
      { property: "og:description", content: "Trucks, trailers and drivers with availability and assignments." },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(fleetQuery),
      context.queryClient.ensureQueryData(driversQuery),
      context.queryClient.ensureQueryData(loadsQuery),
      context.queryClient.ensureQueryData(companiesQuery),
      context.queryClient.ensureQueryData(carriersQuery),
    ]),
  component: Fleet,
});

type Tab = "truck" | "trailer" | "driver";

function StatusDropdown({ value, options, onChange }: { value: string; options: typeof UNIT_STATUSES; onChange: (v: string) => void }) {
  const m = options.find((o) => o.value === value) ?? options[0]!;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-7 w-36 border text-xs", m.cls)}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Fleet() {
  const { data: units } = useSuspenseQuery(fleetQuery);
  const { data: drivers } = useSuspenseQuery(driversQuery);
  const { data: loads } = useSuspenseQuery(loadsQuery);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("truck");
  const [open, setOpen] = useState(false);

  const active = loads.filter((l) => ACTIVE_STATUSES.includes(l.status));
  const loadFor = (key: "truck_id" | "trailer_id" | "driver_id", id: string) => active.find((l) => l[key] === id);
  const lane = (l?: Load) =>
    l ? (
      <span>
        <LoadQuickLook load={l} /> · {l.origin_city}, {l.origin_state} → {l.dest_city}, {l.dest_state}
      </span>
    ) : null;

  const setUnit = async (id: string, status: string) => {
    const { error } = await supabase.from("fleet_units").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["fleet"] });
  };
  const setDriver = async (id: string, status: string) => {
    const { error } = await supabase.from("drivers").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["drivers"] });
  };

  const count = (arr: { status: string }[], s: string) => arr.filter((x) => x.status === s).length;
  const trucks = units.filter((u) => u.kind === "truck");
  const trailers = units.filter((u) => u.kind === "trailer");
  const soon = (d: string | null) => !!d && new Date(d).getTime() - Date.now() < 30 * 86400_000;

  return (
    <div className="space-y-5 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold uppercase">Internal fleet</h1>
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Add {tab}</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {[
          ["Trucks available", count(trucks, "available"), trucks.length],
          ["Trailers available", count(trailers, "available"), trailers.length],
          ["Drivers available", count(drivers, "available"), drivers.length],
        ].map(([k, a, t]) => (
          <div key={k as string} className="rounded border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
            <div className="font-display text-3xl text-gold">{a} <span className="text-lg text-muted-foreground">/ {t}</span></div>
          </div>
        ))}
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="truck">Trucks</TabsTrigger>
          <TabsTrigger value="trailer">Trailers</TabsTrigger>
          <TabsTrigger value="driver">Drivers</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="overflow-x-auto rounded-md border bg-card">
        {tab === "driver" ? (
          <Table>
            <TableHeader><TableRow><TableHead>Driver</TableHead><TableHead>Phone</TableHead><TableHead>CDL</TableHead><TableHead>Medical card</TableHead><TableHead>Status</TableHead><TableHead>Current load</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {drivers.map((d) => (
                <TableRow key={d.id}>
                  <TableCell><div className="font-medium">{d.full_name}</div><div className="text-xs text-muted-foreground">{d.home_city}</div></TableCell>
                  <TableCell>{d.phone}</TableCell>
                  <TableCell className={soon(d.cdl_expires) ? "text-warning" : ""}>{d.cdl_state} {d.cdl_number}<div className="text-xs text-muted-foreground">exp {d.cdl_expires ?? "—"}</div></TableCell>
                  <TableCell className={soon(d.medical_expires) ? "text-warning" : ""}>exp {d.medical_expires ?? "—"}</TableCell>
                  <TableCell><StatusDropdown value={d.status} options={DRIVER_STATUSES} onChange={(v) => setDriver(d.id, v)} /></TableCell>
                  <TableCell className="text-sm">{lane(loadFor("driver_id", d.id)) ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="w-10"><ConfirmDelete table="drivers" id={d.id} label={d.full_name} what="Driver" invalidate={["drivers"]} linked={loadFor("driver_id", d.id) ? "This driver is on an active load — the load will show no driver." : null} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Unit</TableHead><TableHead>Make / model</TableHead><TableHead>Plate</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Current load</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {(tab === "truck" ? trucks : trailers).map((u) => {
                const l = loadFor(tab === "truck" ? "truck_id" : "trailer_id", u.id);
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-gold">{u.unit_number}</TableCell>
                    <TableCell>{u.year} {u.make_model}</TableCell>
                    <TableCell>{u.plate}</TableCell>
                    <TableCell>{u.equipment}</TableCell>
                    <TableCell><StatusDropdown value={u.status} options={UNIT_STATUSES} onChange={(v) => setUnit(u.id, v)} /></TableCell>
                    <TableCell className="text-sm">{l ? <>{lane(l)}<div className="text-xs text-muted-foreground">Delivers {fmtDate(l.delivery_at)}</div></> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="w-10"><ConfirmDelete table="fleet_units" id={u.id} label={u.unit_number} what={tab === "truck" ? "Truck" : "Trailer"} invalidate={["fleet"]} linked={l ? "This unit is on an active load — the load will show no unit." : null} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <AddDialog tab={tab} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function AddDialog({ tab, open, onOpenChange }: { tab: Tab; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string>>({});
  const fields =
    tab === "driver"
      ? [["full_name", "Full name"], ["phone", "Phone"], ["email", "Email"], ["home_city", "Home city"], ["cdl_number", "CDL #"], ["cdl_state", "CDL state"], ["cdl_expires", "CDL expires (YYYY-MM-DD)"], ["medical_expires", "Medical card expires (YYYY-MM-DD)"]]
      : [["unit_number", "Unit #"], ["make_model", "Make / model"], ["year", "Year"], ["vin", "VIN"], ["plate", "Plate"], ["equipment", tab === "truck" ? "Cab type" : "Trailer type"]];
  const save = async () => {
    const v = (k: string) => f[k] || null;
    const { error } =
      tab === "driver"
        ? f.full_name
          ? await supabase.from("drivers").insert({ full_name: f.full_name, phone: v("phone"), email: v("email"), home_city: v("home_city"), cdl_number: v("cdl_number"), cdl_state: v("cdl_state")?.toUpperCase() ?? null, cdl_expires: v("cdl_expires"), medical_expires: v("medical_expires") })
          : { error: { message: "Name is required" } }
        : f.unit_number
          ? await supabase.from("fleet_units").insert({ kind: tab, unit_number: f.unit_number, make_model: v("make_model"), year: f.year ? Number(f.year) : null, vin: v("vin"), plate: v("plate"), equipment: v("equipment") })
          : { error: { message: "Unit # is required" } };
    if (error) return toast.error(error.message);
    toast.success("Added to fleet");
    qc.invalidateQueries({ queryKey: [tab === "driver" ? "drivers" : "fleet"] });
    setF({});
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Add {tab}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(([k, l]) => (
            <label key={k} className="text-xs text-muted-foreground">{l}
              <Input className="mt-1" value={f[k!] ?? ""} onChange={(e) => setF((p) => ({ ...p, [k!]: e.target.value }))} />
            </label>
          ))}
        </div>
        <div className="flex justify-end"><Button onClick={save}>Save</Button></div>
      </DialogContent>
    </Dialog>
  );
}
