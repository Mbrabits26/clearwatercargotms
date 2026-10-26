import { describe, expect, it } from "vitest";
import { customerRefs, freightLineText } from "@/lib/qbInvoiceText";

const base = { load_number: "CW-15418", origin_city: "Springfield", origin_state: "VA", dest_city: "Richmond", dest_state: "VA" };

describe("QuickBooks invoice line text", () => {
  it("includes the customer ref # in the freight description", () => {
    expect(freightLineText({ ...base, customer_ref: "PO-7781" })).toBe(
      "Freight — CW-15418: Springfield, VA to Richmond, VA — Customer ref # PO-7781",
    );
  });

  it("leaves the ref out when the load has none", () => {
    expect(freightLineText({ ...base, customer_ref: "  " })).toBe("Freight — CW-15418: Springfield, VA to Richmond, VA");
  });

  it("lists each distinct customer ref once for a combined invoice", () => {
    expect(customerRefs([{ ...base, customer_ref: "A1" }, { ...base, customer_ref: null }, { ...base, customer_ref: "A1" }, { ...base, customer_ref: "B2" }])).toEqual(["A1", "B2"]);
  });
});
