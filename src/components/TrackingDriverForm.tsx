import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { driversQuery } from "@/lib/queries";
import { isFleetLoad, type Load } from "@/lib/tms";
import { carrierTrackingDriversQuery, initialTrackingContact, saveTrackingDriver, type TrackingContact } from "@/lib/trackingDrivers";

export function TrackingDriverForm({ load, initial, onSubmit }: {
  load: Load;
  initial: TrackingContact | null;
  onSubmit: (contact: TrackingContact) => Promise<boolean>;
}) {
  const qc = useQueryClient();
  const fleet = isFleetLoad(load);
  const fleetQuery = useQuery({ ...driversQuery, enabled: fleet });
  const savedQuery = useQuery({ ...carrierTrackingDriversQuery(load.carrier_id), enabled: !fleet && !!load.carrier_id });
  const [contact, setContact] = useState<TrackingContact>(initial ?? { name: "", phone: "" });
  const [selectedId, setSelectedId] = useState<string | null>(initial ? null : load.driver_id);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const choices = fleet
    ? (fleetQuery.data ?? []).map((d) => ({ id: d.id, name: d.full_name, phone: d.phone ?? "" }))
    : savedQuery.data ?? [];

  useEffect(() => {
    if (touched) return;
    setContact(initialTrackingContact(initial, load.driver_id, choices));
  }, [initial, load.driver_id, fleetQuery.data, savedQuery.data, touched]);

  const choose = (id: string) => {
    setTouched(true);
    const driver = choices.find((d) => d.id === id);
    setSelectedId(driver?.id ?? null);
    setContact(driver ? { name: driver.name, phone: driver.phone } : { name: "", phone: "" });
  };
  const save = async () => {
    setBusy(true);
    try {
      const id = await saveTrackingDriver(contact, { fleet, carrierId: load.carrier_id, selectedId });
      setSelectedId(id);
      setTouched(true);
      await qc.invalidateQueries({ queryKey: fleet ? ["drivers"] : ["carrier_tracking_drivers", load.carrier_id] });
      toast.success("Driver number saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the driver number.");
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      {(fleet || load.carrier_id) && <Select value={selectedId ?? "manual"} onValueChange={choose}>
        <SelectTrigger aria-label={fleet ? "Fleet driver" : "Saved carrier driver"} className="w-full min-w-0">
          <SelectValue placeholder={fleet ? "Fleet driver" : "Saved carrier driver"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manual">{fleet ? "Another fleet driver" : "One-time / new driver"}</SelectItem>
          {choices.map((d) => <SelectItem key={d.id} value={d.id}>{d.name || "Driver"}{d.phone ? ` · ${d.phone}` : ""}</SelectItem>)}
        </SelectContent>
      </Select>}
      {(fleetQuery.isError && fleet || savedQuery.isError && !fleet) && <div className="text-xs text-destructive">Couldn't load saved drivers. You can still enter the number.</div>}
      <Input aria-label="Tracking driver name" value={contact.name} onChange={(e) => { setTouched(true); setContact((c) => ({ ...c, name: e.target.value })); }} placeholder="Driver name (optional)" />
      <Input aria-label="Tracking driver phone" type="tel" value={contact.phone} onChange={(e) => { setTouched(true); setContact((c) => ({ ...c, phone: e.target.value })); }} placeholder="Driver phone (optional)" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await onSubmit(contact); } finally { setBusy(false); } }}>{initial ? "Update tracking driver" : "Create tracking link"}</Button>
        {(fleet || load.carrier_id) && <Button size="sm" variant="outline" disabled={busy || !contact.name.trim() || !contact.phone.trim()} onClick={save}><Save className="mr-1 h-3.5 w-3.5" />{fleet ? "Save fleet driver" : "Save repeat driver"}</Button>}
      </div>
    </div>
  );
}