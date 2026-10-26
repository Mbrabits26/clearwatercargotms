import { describe, expect, it } from "vitest";
import { billingStage, invoiceNumberOf } from "@/lib/reportBilling";

const sent = { load_id: "a", kind: "invoice", status: "sent", qb_ref: "6104", invoice_number: "2673" };
const queued = { load_id: "a", kind: "invoice", status: "queued", qb_ref: null, invoice_number: "INV-10050" };
const bill = { load_id: "a", kind: "bill", status: "sent", qb_ref: "9", invoice_number: "B-1" };

describe("billingStage", () => {
  it("delivered with no invoice needs invoicing", () => {
    expect(billingStage({ id: "a", status: "delivered" }, [])).toBe("needs_invoice");
  });
  it("invoiced but not yet in QuickBooks", () => {
    expect(billingStage({ id: "a", status: "invoiced" }, [queued])).toBe("invoiced");
  });
  it("a sent customer invoice means awaiting payment", () => {
    expect(billingStage({ id: "a", status: "invoiced" }, [sent])).toBe("sent");
  });
  it("a sent carrier bill does not count as a customer invoice", () => {
    expect(billingStage({ id: "a", status: "delivered" }, [bill])).toBe("needs_invoice");
  });
  it("paid status is paid", () => {
    expect(billingStage({ id: "a", status: "paid" }, [sent])).toBe("paid");
  });
  it("rolling loads are not delivered yet", () => {
    expect(billingStage({ id: "a", status: "rolling" }, [])).toBe("not_delivered");
  });
});

describe("invoiceNumberOf", () => {
  it("prefers the sent invoice number and ignores carrier bills", () => {
    expect(invoiceNumberOf("a", [queued, bill, sent])).toBe("2673");
    expect(invoiceNumberOf("a", [bill])).toBe("");
  });
});
