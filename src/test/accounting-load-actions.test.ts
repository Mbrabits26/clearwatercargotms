import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Load } from "@/lib/tms";

const db = vi.hoisted(() => ({ update: vi.fn(), rpc: vi.fn(), select: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ update: (row: unknown) => { db.update(row); return { eq: () => ({ select: db.select }) }; } }),
  rpc: db.rpc,
} }));
vi.mock("@/components/BatchInvoiceDialog", () => ({ BatchInvoiceDialog: () => null }));
import { buildLoadListActions } from "@/components/LoadListBar";

const load = (id: string, status: Load["status"] = "invoiced") => ({ id, load_number: id, status, closed_at: null } as Load);
const action = () => buildLoadListActions({ actions: ["paid_closeout"] })[0];

beforeEach(() => {
  vi.clearAllMocks();
  db.select.mockResolvedValue({ data: [{ id: "ok" }], error: null });
  db.rpc.mockResolvedValue({ data: [{ ok: true }], error: null });
});

describe("checked Accounting Paid + Closeout", () => {
  it("marks the customer paid and then closes out all 115 checked loads without a 100-load call", async () => {
    const selected = Array.from({ length: 115 }, (_, i) => load(`CW-${i}`));
    const results = await Promise.all(selected.map((l) => action()?.each?.(l, "Customer payment reviewed")));
    expect(results).toEqual(Array(115).fill(null));
    expect(db.update).toHaveBeenCalledTimes(115);
    expect(db.update).toHaveBeenCalledWith({ status: "paid" });
    expect(db.rpc).toHaveBeenCalledTimes(115);
    selected.forEach((l) => expect(db.rpc).toHaveBeenCalledWith("batch_load_action", { _ids: [l.id], _action: "closeout", _note: "Customer payment reviewed" }));
  });
  it("does not close out a load when recording customer payment is refused", async () => {
    db.select.mockResolvedValue({ data: null, error: { message: "Customer invoice required" } });
    expect(await action()?.each?.(load("CW-115"), "Reviewed")).toContain("Customer invoice required");
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("closes an already-paid load without recording payment again", async () => {
    expect(await action()?.each?.(load("CW-115", "paid"), "Reviewed")).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("skips cancelled and already closed-out loads", async () => {
    await action()?.each?.(load("CW-1", "cancelled"), "Reviewed");
    await action()?.each?.({ ...load("CW-2"), closed_at: "2026-11-12" }, "Reviewed");
    expect(db.update).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("reports partial completion when closeout fails after customer payment", async () => {
    db.rpc.mockResolvedValue({ data: [{ ok: false, error: "Closeout refused" }], error: null });
    expect(await action()?.each?.(load("CW-115"), "Reviewed")).toContain("customer paid, but closeout failed");
  });
});