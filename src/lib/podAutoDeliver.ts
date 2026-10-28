/**
 * Auto-delivery from the driver/carrier tracking link.
 * A load moves to Delivered automatically only when a signed POD is on file,
 * triggered by either a POD upload or a "Delivered" status tap through the link.
 * Staff can still change status manually at any time.
 */
export const AUTO_DELIVER_FROM = ["booked", "dispatched", "rolling"] as const;

export type AutoDeliverLoad = {
  status: string;
  pod_received: boolean;
  customer_id: string | null;
  carrier_id: string | null;
  truck_id: string | null;
  closed_at?: string | null;
};

export function shouldAutoDeliver(load: AutoDeliverLoad): boolean {
  if (!load.pod_received) return false;
  if (load.closed_at) return false;
  if (!(AUTO_DELIVER_FROM as readonly string[]).includes(load.status)) return false;
  // Mirror the load rules: a delivered load needs a customer and a carrier or company truck.
  if (!load.customer_id) return false;
  if (!load.carrier_id && !load.truck_id) return false;
  return true;
}
