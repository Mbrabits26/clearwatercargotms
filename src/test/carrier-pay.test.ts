import { describe, expect, it } from "vitest";
import { carrierPayDue, owesCarrier, payTo, shouldNotify, type PayCarrier } from "@/lib/carrierPay";
import { FLEET_CARRIER_ID, type Load } from "@/lib/tms";

const DAY = 86_400_000;
const pod = "2026-10-01T12:00:00Z";
const t0 = new Date(pod).getTime();
const load = (o: Partial<Load> = {}) => ({
  id: "l1", status: "delivered", carrier_id: "c1", pod_received: true, pod_received_at: pod, carrier_paid_at: null,
  carrier_rate: 2000, customer_rate: 2500, accessorials: [], truck_id: null, driver_id: null, pay_terms: null,
  delivery_at: pod, created_at: pod, ...o,
}) as unknown as Load;
const carrier = (o: Partial<PayCarrier> = {}): PayCarrier => ({
  id: "c1", legal_name: "Acme Trucking", pay_terms: "net30", factoring_company: null, factoring_remit: null,
  factoring_remit_address: null, noa_received: false, address: "1 Main St", city: "Raleigh", state: "NC", zip: "27601", ...o,
});

describe("carrier pay due", () => {
  it("Quick Pay is due 3 days after the POD with a 5% fee", () => {
    const d = carrierPayDue(load(), carrier({ pay_terms: "quickpay" }), t0);
    expect(d.due).toBe(t0 + 3 * DAY);
    expect(d.fee).toBe(100);
    expect(d.net).toBe(1900);
  });
  it("Factored Quick Pay takes a 2.5% fee", () => {
    expect(carrierPayDue(load(), carrier({ pay_terms: "factored_quickpay" }), t0).net).toBe(1950);
  });
  it("Net 30 is due 30 days after the POD with no fee", () => {
    const d = carrierPayDue(load(), carrier(), t0);
    expect(d.due).toBe(t0 + 30 * DAY);
    expect(d.net).toBe(2000);
  });
  it("Quick Pay notifies as soon as the POD is in", () => {
    expect(shouldNotify(carrierPayDue(load(), carrier({ pay_terms: "quickpay" }), t0), 3)).toBe(true);
  });
  it("Net 30 waits until it is within the heads-up window", () => {
    expect(shouldNotify(carrierPayDue(load(), carrier(), t0), 3)).toBe(false);
    expect(shouldNotify(carrierPayDue(load(), carrier(), t0 + 27 * DAY), 3)).toBe(true);
  });
  it("only brokered, POD-received, unpaid loads are owed", () => {
    expect(owesCarrier(load())).toBe(true);
    expect(owesCarrier(load({ pod_received: false }))).toBe(false);
    expect(owesCarrier(load({ carrier_paid_at: pod }))).toBe(false);
    expect(owesCarrier(load({ carrier_id: FLEET_CARRIER_ID }))).toBe(false);
    expect(owesCarrier(load({ status: "rolling" }))).toBe(false);
  });
  it("an invoiced older load without a POD is still owed, clocked from delivery", () => {
    const old = load({ pod_received: false, pod_received_at: null, delivery_at: "2026-01-05T12:00:00Z" });
    expect(owesCarrier(old)).toBe(false);
    expect(owesCarrier(old, true)).toBe(true);
    expect(owesCarrier(load({ pod_received: false, pod_received_at: null, status: "invoiced" }))).toBe(true);
    const d = carrierPayDue(old, carrier(), t0);
    expect(d.due).toBe(new Date("2026-01-05T12:00:00Z").getTime() + 30 * DAY);
    expect(shouldNotify(d, 3)).toBe(true);
  });
  it("factored carriers are paid to the factoring company", () => {
    const p = payTo(carrier({ factoring_company: "RTS Financial", factoring_remit_address: "PO Box 1, Dallas TX" }));
    expect(p.name).toBe("RTS Financial");
    expect(p.address).toBe("PO Box 1, Dallas TX");
    expect(p.noaMissing).toBe(true);
    expect(payTo(carrier()).name).toBe("Acme Trucking");
  });
});
