import { describe, expect, it } from "vitest";
import { removalRecipient } from "@/lib/carrierRemoved";

const carrier = { legal_name: "Acme Trucking LLC", email: "office@acme.com", mc_number: "123456", dot_number: null };
const req = (id: string, created_at: string, carrierName: string, carrier_email: string | null, carrierMc = "") =>
  ({ id, status: "sent", created_at, carrier_email, snapshot: { carrier: carrierName, carrierMc } });

describe("carrier removed email recipient", () => {
  it("sends nothing when the carrier was never sent a rate con for the load", () => {
    expect(removalRecipient([req("r1", "2026-10-20", "Other Carrier", "x@other.com")], carrier)).toBeNull();
  });

  it("emails the first address the latest rate con went to", () => {
    const r = removalRecipient([
      req("old", "2026-10-20", "Acme Trucking LLC", "old@acme.com"),
      req("new", "2026-10-22", "Acme Trucking LLC", "dispatch@acme.com, billing@acme.com"),
    ], carrier);
    expect(r).toEqual({ to: "dispatch@acme.com", requestId: "new" });
  });

  it("falls back to the carrier's saved email when the rate con had no address", () => {
    expect(removalRecipient([req("r1", "2026-10-22", "Acme Trucking LLC", null)], carrier)).toEqual({ to: "office@acme.com", requestId: "r1" });
  });

  it("matches a rate con by MC number even if the name was edited", () => {
    expect(removalRecipient([req("r1", "2026-10-22", "Acme", "d@acme.com", "MC 123456")], carrier)?.to).toBe("d@acme.com");
  });
});
