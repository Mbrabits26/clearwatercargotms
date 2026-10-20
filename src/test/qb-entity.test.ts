import { describe, it, expect } from "vitest";
import { entityForKind, entityId } from "@/lib/quickbooks.server";

describe("QuickBooks company routing", () => {
  it("sends fleet invoices to Foust Farms", () => expect(entityForKind("fleet_invoice")).toBe("fleet"));
  it("sends customer invoices to Clearwater", () => expect(entityForKind("invoice")).toBe("brokerage"));
  it("sends carrier bills to Clearwater", () => expect(entityForKind("bill")).toBe("brokerage"));
  it("keeps the slots distinct", () => expect(entityId("fleet")).not.toBe(entityId("brokerage")));
});
