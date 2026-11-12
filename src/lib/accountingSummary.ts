import { carrierPayDue, owesCarrier, type PayCarrier } from "@/lib/carrierPay";
import { isFleetLoad, type Load } from "@/lib/tms";

export function carrierAccountingEntries(loads: Load[], carriers: Map<string, PayCarrier>, invoiced: Set<string>, now = Date.now()) {
  return loads.filter((l) => l.status !== "cancelled" && l.carrier_id && !isFleetLoad(l)).map((load) => {
    const pay = carrierPayDue(load, carriers.get(load.carrier_id ?? ""), now);
    return { load, pay, owed: owesCarrier(load, invoiced.has(load.id)), collected: !!load.carrier_paid_at };
  });
}

export function agingTotal(entries: { amount: number; age: number }[]) {
  const sum = (accept: (age: number) => boolean) => Math.round(entries.filter((e) => accept(e.age)).reduce((t, e) => t + e.amount, 0) * 100) / 100;
  return { total: sum(() => true), a: sum((a) => a <= 30), b: sum((a) => a > 30 && a <= 60), c: sum((a) => a > 60) };
}