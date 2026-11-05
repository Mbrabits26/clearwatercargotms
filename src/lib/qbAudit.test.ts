import { describe, it, expect } from "vitest";
import { findDuplicates, matchPayment, type AuditInvoice } from "./qbAudit";

const inv = (p: Partial<AuditInvoice>): AuditInvoice => ({ id: "1", entity: "brokerage", docNumber: null, date: "2026-10-01", customer: "Peak City Lumber", total: 1700, balance: 1700, text: "", lines: [], ...p });

describe("findDuplicates", () => {
  it("flags same doc number + customer + amount and keeps the TMS-linked one", () => {
    const d = findDuplicates([inv({ id: "6380", docNumber: "INV-10059" }), inv({ id: "6379", docNumber: "INV-10059", loadNumber: "CW-10510" })]);
    expect(d).toHaveLength(1);
    expect(d[0].keep.id).toBe("6379");
    expect(d[0].extra.id).toBe("6380");
    expect(d[0].overstated).toBe(1700);
  });
  it("flags a shared PO with different doc numbers", () => {
    const d = findDuplicates([inv({ id: "a", docNumber: "2156", text: "PO 386944" }), inv({ id: "b", docNumber: "FF-1026", text: "Ref 386944", date: "2026-10-20" })]);
    expect(d[0]?.kind).toBe("same-ref");
  });
  it("does not pair same customer+amount with nothing else in common", () => {
    expect(findDuplicates([inv({ id: "a", docNumber: "1", text: "PO 111111" }), inv({ id: "b", docNumber: "2", text: "PO 222222", date: "2026-10-09" })])).toHaveLength(0);
  });
  it("never pairs across QuickBooks companies", () => {
    expect(findDuplicates([inv({ id: "a", docNumber: "X1" }), inv({ id: "a", entity: "fleet", docNumber: "X1" })])).toHaveLength(0);
  });
});

describe("matchPayment", () => {
  const book = [inv({ id: "1", docNumber: "INV-100", balance: 1700 }), inv({ id: "2", docNumber: "INV-101", total: 900, balance: 0 })];
  it("matches by invoice number and reports full / already paid / short", () => {
    const m = matchPayment({ payer: "Peak City", check_number: "55", date: null, total: null, lines: [{ ref: "INV-100", amount: 1700 }, { ref: "inv 101", amount: 900 }] }, book);
    expect(m.map((x) => x.status)).toEqual(["matches", "already-paid"]);
    expect(matchPayment({ payer: null, check_number: null, date: null, total: null, lines: [{ ref: "INV-100", amount: 1500 }] }, book)[0].status).toBe("short");
  });
  it("falls back to payer + open amount as probable only", () => {
    const m = matchPayment({ payer: "Peak City Lumber", check_number: null, date: null, total: null, lines: [{ ref: null, amount: 1700 }] }, book);
    expect(m[0].confidence).toBe("probable");
  });
  it("reports not found", () => {
    expect(matchPayment({ payer: "Nobody", check_number: null, date: null, total: null, lines: [{ ref: "ZZ-9", amount: 5 }] }, book)[0].status).toBe("not-found");
  });
});
