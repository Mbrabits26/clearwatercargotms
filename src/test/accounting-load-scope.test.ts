import { describe, expect, it } from "vitest";
import { accountingLoadInScope } from "@/lib/accountingLoadScope";

describe("Accounting load history", () => {
  it("finds a paid load without reopening it", () => {
    const load = { status: "paid", closed_at: null };
    expect(accountingLoadInScope(load, "all")).toBe(true);
    expect(accountingLoadInScope(load, "history")).toBe(true);
    expect(accountingLoadInScope(load, "active")).toBe(false);
    expect(load.status).toBe("paid");
  });
  it("finds a closed-out load while preserving its closeout", () => {
    const load = { status: "invoiced", closed_at: "2026-11-13T18:10:00Z" };
    expect(accountingLoadInScope(load, "history")).toBe(true);
    expect(accountingLoadInScope(load, "all")).toBe(true);
    expect(accountingLoadInScope(load, "active")).toBe(false);
    expect(load.closed_at).toBe("2026-11-13T18:10:00Z");
  });
  it("includes delivered and invoiced loads in the completed view", () => {
    for (const status of ["delivered", "invoiced"]) {
      expect(accountingLoadInScope({ status, closed_at: null }, "all")).toBe(true);
      expect(accountingLoadInScope({ status, closed_at: null }, "active")).toBe(true);
      expect(accountingLoadInScope({ status, closed_at: null }, "history")).toBe(false);
    }
  });
  it("does not mix rolling or cancelled loads into completed accounting", () => {
    expect(accountingLoadInScope({ status: "rolling", closed_at: null }, "all")).toBe(false);
    expect(accountingLoadInScope({ status: "cancelled", closed_at: "2026-11-13" }, "all")).toBe(false);
  });
});