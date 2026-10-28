import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { auditBill, auditFlags, chargeCategory } from "@/lib/billAudit";
import { factoringBatches } from "@/lib/factoring";
import { mergePacket, packetDefault, packetDocKind, packetHidden } from "@/lib/invoicePacket";
import type { PayCarrier } from "@/lib/carrierPay";
import type { Load } from "@/lib/tms";

describe("carrier bill audit", () => {
  const rc = { rcTotal: 2300, rcLines: [{ label: "Linehaul", amount: 2100 }, { label: "Tracking & paperwork fee", amount: 200 }], loadCost: 2300 };
  it("matches when the carrier bills the signed rate con total", () => {
    expect(auditBill({ ...rc, billed: 2300 }).status).toBe("match");
  });
  it("flags billing over the rate con with the difference", () => {
    const a = auditBill({ ...rc, billed: 2450 });
    expect(a.status).toBe("over");
    expect(a.diff).toBe(150);
  });
  it("flags detention that isn't on the rate con", () => {
    const a = auditBill({ ...rc, billed: 2450, billedLines: [{ description: "Line haul", amount: 2300 }, { description: "Detention 3 hrs", amount: 150 }] });
    expect(a.unexpected.map((l) => l.description)).toEqual(["Detention 3 hrs"]);
  });
  it("accepts detention that the rate con includes", () => {
    const a = auditBill({ rcTotal: 2150, rcLines: [{ label: "Linehaul", amount: 2000 }, { label: "Detention", amount: 150 }], loadCost: 2150, billed: 2150, billedLines: [{ description: "Freight", amount: 2000 }, { description: "Detention", amount: 150 }] });
    expect(a.unexpected).toEqual([]);
  });
  it("reads a $200 short bill on a tracking rate con as a forfeited tracking fee", () => {
    expect(auditBill({ ...rc, billed: 2100 }).trackingForfeit).toBe(true);
  });
  it("flags carrier pay changed after the rate con was signed", () => {
    expect(auditBill({ ...rc, loadCost: 2500, billed: 2300 }).rcChanged).toBe(true);
  });
  it("without a signed rate con it compares to the load's carrier pay", () => {
    const a = auditBill({ rcTotal: null, loadCost: 1800, billed: 1800 });
    expect(a.status).toBe("match");
    expect(auditFlags(a)).toContain("No signed rate con — compared to load carrier pay");
  });
  it("categorises common accessorials", () => {
    expect(chargeCategory("Lumper fee")).toBe("lumper");
    expect(chargeCategory("TONU")).toBe("tonu");
    expect(chargeCategory("Fuel surcharge")).toBe("fuel");
  });
});

describe("factoring remittance batches", () => {
  const load = (id: string, carrier: string, rate: number) => ({ id, load_number: id, status: "delivered", carrier_id: carrier, pod_received: true, pod_received_at: "2026-10-01T12:00:00Z", carrier_paid_at: null, carrier_rate: rate, customer_rate: rate + 500, accessorials: [], truck_id: null, driver_id: null, pay_terms: null, delivery_at: "2026-10-01T12:00:00Z", created_at: "2026-10-01T12:00:00Z" }) as unknown as Load;
  const carrier = (id: string, o: Partial<PayCarrier>): PayCarrier => ({ id, legal_name: `Carrier ${id}`, pay_terms: "factoring", factoring_company: null, factoring_remit: null, factoring_remit_address: null, noa_received: true, address: null, city: null, state: null, zip: null, ...o } as PayCarrier);
  const carriers = new Map<string, PayCarrier>([
    ["a", carrier("a", { factoring_company: "RTS Financial", factoring_remit_address: "PO Box 840267, Dallas TX 75284" })],
    ["b", carrier("b", { factoring_company: "RTS Financial, Inc.", factoring_remit_address: "PO Box 840267, Dallas TX 75284", noa_received: false })],
    ["c", carrier("c", {})],
  ]);
  const batches = factoringBatches([load("L1", "a", 2000), load("L2", "b", 1500), load("L3", "c", 1000)], carriers, new Set());
  it("groups loads of carriers that factor with the same company", () => {
    expect(batches).toHaveLength(1);
    expect(batches[0]!.rows.map((r) => r.load.id).sort()).toEqual(["L1", "L2"]);
    expect(batches[0]!.net).toBe(3500);
  });
  it("leaves out carriers that don't factor", () => {
    expect(batches.flatMap((b) => b.rows).some((r) => r.load.id === "L3")).toBe(false);
  });
  it("lists carriers with no NOA on file", () => {
    expect(batches[0]!.noaMissing).toEqual(["Carrier b"]);
  });
  it("flags different remit addresses for the same factor", () => {
    const m = new Map(carriers);
    m.set("b", carrier("b", { factoring_company: "RTS Financial", factoring_remit_address: "123 New St, Miami FL" }));
    expect(factoringBatches([load("L1", "a", 2000), load("L2", "b", 1500)], m, new Set())[0]!.remitConflict).toBe(true);
  });
  it("skips loads already marked paid", () => {
    const paid = { ...load("L1", "a", 2000), carrier_paid_at: "2026-10-05T00:00:00Z" } as Load;
    expect(factoringBatches([paid], carriers, new Set())).toEqual([]);
  });
});

describe("invoice packet", () => {
  it("ticks POD and BOL by default but not the carrier rate con", () => {
    expect(packetDefault(packetDocKind("L1/pod-123.jpg"))).toBe(true);
    expect(packetDefault(packetDocKind("L1/file-1-signed_BOL.pdf"))).toBe(true);
    expect(packetDocKind("L1/ratecon-CW-100-signed.pdf")).toBe("ratecon");
    expect(packetDefault("ratecon")).toBe(false);
  });
  it("never offers carrier invoices in a customer packet", () => {
    expect(packetHidden(packetDocKind("L1/carrier_invoice-1-inv.pdf"))).toBe(true);
  });
  it("puts the invoice first and appends PDF pages and photos", async () => {
    const mk = async (pages: number) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage(); return d.save(); };
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const r = await mergePacket(await mk(1), [{ name: "pod.pdf", bytes: await mk(2) }, { name: "pod.png", bytes: png }, { name: "notes.docx", bytes: new Uint8Array([1, 2, 3]) }]);
    expect(r.pages).toBe(4);
    expect(r.skipped).toEqual(["notes.docx"]);
  });
});
