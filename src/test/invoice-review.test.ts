import { describe, expect, it } from "vitest";
import { isInvoicedNote, qbReviewState } from "@/lib/invoiceReview";

const load = { id: "L1", status: "invoiced" };

describe("invoiced loads awaiting QuickBooks review", () => {
  it("lists an invoiced load with no invoice queued", () => {
    expect(qbReviewState(load, [])).toBe("not_queued");
  });
  it("keeps a queued invoice on the list until it is sent", () => {
    expect(qbReviewState(load, [{ load_id: "L1", kind: "invoice", status: "queued" }])).toBe("queued");
  });
  it("flags a failed send", () => {
    expect(qbReviewState(load, [{ load_id: "L1", kind: "fleet_invoice", status: "error" }])).toBe("error");
  });
  it("drops the load once its invoice is in QuickBooks", () => {
    expect(qbReviewState(load, [{ load_id: "L1", kind: "invoice", status: "sent", qb_ref: "123" }])).toBeNull();
  });
  it("ignores carrier bills when deciding", () => {
    expect(qbReviewState(load, [{ load_id: "L1", kind: "bill", status: "sent", qb_ref: "9" }])).toBe("not_queued");
  });
  it("does not list loads that are not invoiced", () => {
    expect(qbReviewState({ id: "L1", status: "delivered" }, [])).toBeNull();
    expect(qbReviewState({ id: "L1", status: "paid" }, [])).toBeNull();
  });
  it("detects a move into Invoiced from the status history", () => {
    expect(isInvoicedNote("Status changed: delivered → invoiced")).toBe(true);
    expect(isInvoicedNote("Status changed: invoiced → paid")).toBe(false);
  });
});
