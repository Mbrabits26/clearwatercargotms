import { describe, expect, it } from "vitest";
import { bulkStatusSkip } from "@/lib/bulkStatus";

describe("Bulk status change from reports", () => {
  it("changes an open delivered load to invoiced", () => expect(bulkStatusSkip({ status: "delivered", closed_at: null }, "invoiced")).toBeNull());
  it("skips loads already at the chosen status", () => expect(bulkStatusSkip({ status: "paid", closed_at: null }, "paid")).not.toBeNull());
  it("never bulk-cancels loads", () => expect(bulkStatusSkip({ status: "available", closed_at: null }, "cancelled")).not.toBeNull());
  it("skips cancelled loads", () => expect(bulkStatusSkip({ status: "cancelled", closed_at: null }, "available")).not.toBeNull());
  it("lets closed-out loads move only between delivered, invoiced and paid", () => {
    expect(bulkStatusSkip({ status: "invoiced", closed_at: "2026-10-01" }, "paid")).toBeNull();
    expect(bulkStatusSkip({ status: "invoiced", closed_at: "2026-10-01" }, "rolling")).not.toBeNull();
  });
});
