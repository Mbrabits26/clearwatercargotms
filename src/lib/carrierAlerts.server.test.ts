import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { postCarrierSafetyAlert } from "./carrierAlerts.server";

function fakeDb() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const eq = vi.fn().mockResolvedValue({ data: [{ user_id: "admin" }], error: null });
  const from = vi.fn((table: string) => table === "user_roles" ? { select: () => ({ eq }) } : { insert });
  return { db: { from } as unknown as SupabaseClient<Database>, insert };
}

describe("addressed carrier safety delivery", () => {
  it("delivers an RC signing alert to its sending broker, assigned broker and admin", async () => {
    const { db, insert } = fakeDb();
    await postCarrierSafetyAlert(db, { senderId: "sending-broker", brokerId: "assigned-broker", source: "signing_risk", body: "Non-US signature", loadId: "load" });
    expect(insert.mock.calls[0]?.[0]).toEqual([
      { user_id: "sending-broker", author_id: "sending-broker", source: "signing_risk", body: "Non-US signature", load_id: "load" },
      { user_id: "assigned-broker", author_id: "sending-broker", source: "signing_risk", body: "Non-US signature", load_id: "load" },
      { user_id: "admin", author_id: "sending-broker", source: "signing_risk", body: "Non-US signature", load_id: "load" },
    ]);
  });
  it("delivers a packet signature alert to the sending broker and admin without a load", async () => {
    const { db, insert } = fakeDb();
    await postCarrierSafetyAlert(db, { senderId: "broker", source: "signing_risk", body: "Packet" });
    expect(insert.mock.calls[0]?.[0].map((r: { user_id: string }) => r.user_id)).toEqual(["broker", "admin"]);
  });
  it("delivers an informational check to the checking broker and admin", async () => {
    const { db, insert } = fakeDb();
    await postCarrierSafetyAlert(db, { senderId: "checking-broker", source: "carrier_check", body: "Yellow" });
    expect(insert.mock.calls[0]?.[0].map((r: { user_id: string }) => r.user_id)).toEqual(["checking-broker", "admin"]);
  });
});