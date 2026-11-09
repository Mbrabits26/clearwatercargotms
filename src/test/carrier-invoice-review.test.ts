import { describe, it, expect } from "vitest";
import { invoiceReviewSchema } from "@/lib/carrierInvoiceReview";
import { retypedName } from "@/components/DocTypePicker";
import { packetDocKind, packetHidden } from "@/lib/invoicePacket";
const load = "b5b696c1-c82a-42f3-9cad-feeae7bac237";
const base = { load, bill: null, path: `${load}/invoice.pdf`, kind: "regular", number: "123", amount: 1000, lines: [], factor: null, account: null };
describe("carrier invoice review", () => {
  it("accepts a typed document description instead of Other", () => expect(retypedName("other", "receipt.pdf", "Trailer repair receipt")).toBe("Trailer repair receipt – receipt.pdf"));
  it("regular invoices do not change factoring details", () => expect(invoiceReviewSchema.safeParse({ ...base, factor: { company: "Factor", address: "Remit address" } }).success).toBe(false));
  it("factoring invoice requires company and remit address when saving to carrier", () => expect(invoiceReviewSchema.safeParse({ ...base, kind: "factoring", factor: { company: "Factor", address: "" } }).success).toBe(false));
  it("invoice cannot be assigned from a different load", () => expect(invoiceReviewSchema.safeParse({ ...base, path: "different-load/file.pdf" }).success).toBe(false));
  it("factoring invoices stay out of customer invoice packets", () => expect(packetHidden(packetDocKind(`${load}/factoring_invoice-123.pdf`))).toBe(true));
});