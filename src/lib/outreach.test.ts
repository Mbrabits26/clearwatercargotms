import { describe, expect, it } from "vitest";
import { inSendWindow, senderCanSend, isOptOut, addDays } from "./outreach";

// 2026-10-29 is a Thursday; New York is UTC-4.
const at = (iso: string) => new Date(iso);

describe("outreach rules", () => {
  it("sends only 8:00–4:30 Eastern on weekdays", () => {
    expect(inSendWindow(at("2026-10-29T11:59:00Z"))).toBe(false); // 7:59 ET
    expect(inSendWindow(at("2026-10-29T12:00:00Z"))).toBe(true); // 8:00 ET
    expect(inSendWindow(at("2026-10-29T20:30:00Z"))).toBe(false); // 4:30 PM ET
    expect(inSendWindow(at("2026-10-31T15:00:00Z"))).toBe(false); // Saturday
  });
  it("stops at the daily cap and never above 40", () => {
    const now = at("2026-10-29T15:00:00Z");
    expect(senderCanSend({ daily_cap: 20, last_sent_at: null }, 20, now)).toBe(false);
    expect(senderCanSend({ daily_cap: 20, last_sent_at: null }, 19, now)).toBe(true);
    expect(senderCanSend({ daily_cap: 100, last_sent_at: null }, 40, now)).toBe(false);
  });
  it("waits at least 5 minutes between emails", () => {
    const now = at("2026-10-29T15:00:00Z");
    expect(senderCanSend({ daily_cap: 20, last_sent_at: "2026-10-29T14:56:00Z" }, 1, now)).toBe(false);
    expect(senderCanSend({ daily_cap: 20, last_sent_at: "2026-10-29T14:55:00Z" }, 1, now)).toBe(true);
  });
  it("treats 'pass' and unsubscribe replies as opt-outs", () => {
    expect(isOptOut("Pass, thanks")).toBe(true);
    expect(isOptOut("Please remove me")).toBe(true);
    expect(isOptOut("Can you quote Charlotte to Atlanta?")).toBe(false);
  });
  it("spaces touches by days", () => expect(addDays("2026-10-29", 3)).toBe("2026-11-01"));
});
