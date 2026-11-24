import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { rateconPhone } from "@/lib/rateconDelivery";

export type TrackingContact = { name: string; phone: string };
export type DriverChoice = { id: string; name: string; phone: string };

export function initialTrackingContact(
  initial: TrackingContact | null,
  assignedDriverId: string | null,
  fleetDrivers: DriverChoice[],
): TrackingContact {
  if (initial) return initial;
  const assigned = fleetDrivers.find((driver) => driver.id === assignedDriverId);
  return assigned ? { name: assigned.name, phone: assigned.phone } : { name: "", phone: "" };
}

export const carrierTrackingDriversQuery = (carrierId: string | null) => queryOptions({
  queryKey: ["carrier_tracking_drivers", carrierId],
  enabled: !!carrierId,
  queryFn: async () => {
    if (!carrierId) return [];
    const { data, error } = await supabase.from("carrier_tracking_drivers")
      .select("id, driver_name, driver_phone").eq("carrier_id", carrierId).order("driver_name");
    if (error) throw error;
    return (data ?? []).map((driver) => ({ id: driver.id, name: driver.driver_name, phone: driver.driver_phone }));
  },
});

/** Saving is an explicit staff action, never a side effect of creating a tracking link. */
export async function saveTrackingDriver(
  contact: TrackingContact,
  scope: { fleet: boolean; carrierId: string | null; selectedId: string | null },
): Promise<string> {
  const phone = rateconPhone(contact.phone);
  const name = contact.name.trim();
  if (!phone || !name) throw new Error("Enter a driver name and valid phone number before saving.");
  if (scope.fleet) {
    const result = scope.selectedId
      ? await supabase.from("drivers").update({ full_name: name, phone }).eq("id", scope.selectedId).select("id").single()
      : await supabase.from("drivers").insert({ full_name: name, phone }).select("id").single();
    if (result.error) throw result.error;
    return result.data.id;
  }
  if (!scope.carrierId) throw new Error("Assign a carrier before saving a repeat driver.");
  const values = { carrier_id: scope.carrierId, driver_name: name, driver_phone: phone };
  const result = scope.selectedId
    ? await supabase.from("carrier_tracking_drivers").update(values).eq("id", scope.selectedId).eq("carrier_id", scope.carrierId).select("id").single()
    : await supabase.from("carrier_tracking_drivers").upsert(values, { onConflict: "carrier_id,driver_phone" }).select("id").single();
  if (result.error) throw result.error;
  return result.data.id;
}