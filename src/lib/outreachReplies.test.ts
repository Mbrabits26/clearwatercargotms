import { describe, expect, it } from "vitest";
import { replyPlan, emailFrom, stripQuoted, findBouncedEmail, replySearches, fallbackCategory } from "./outreach";

const today = "2026-10-30";

describe("automatic reply handling", () => {
  it("a hot reply stops follow-ups, moves the lead to Quoting and alerts the team", () => {
    const p = replyPlan("hot", { stage: "contacted", today });
    expect(p.stop).toBe(true);
    expect(p.alert).toBe(true);
    expect(p.lead).toMatchObject({ outreach_status: "replied", stage: "quoting", next_follow_up: today });
  });
  it("opt-outs and not-interested become do-not-contact and lost, with no alert", () => {
    for (const c of ["opt_out", "not_interested"] as const) {
      const p = replyPlan(c, { stage: "contacted", today });
      expect(p.stop).toBe(true);
      expect(p.alert).toBe(false);
      expect(p.lead).toMatchObject({ do_not_contact: true, stage: "lost", outreach_status: "stopped" });
    }
  });
  it("out-of-office replies leave the sequence running", () => {
    const p = replyPlan("auto_reply", { stage: "contacted", today });
    expect(p.stop).toBe(false);
    expect(p.lead).toBeNull();
  });
  it("'reach out later' sets the reminder to their date, or 45 days out", () => {
    expect(replyPlan("later", { stage: "contacted", today, followUp: "2027-01-15" }).lead).toMatchObject({ next_follow_up: "2027-01-15" });
    expect(replyPlan("later", { stage: "contacted", today, followUp: null }).lead).toMatchObject({ next_follow_up: "2026-12-14" });
  });
  it("a bounce stops follow-ups but does not mark do-not-contact", () => {
    const p = replyPlan("bounce", { stage: "new", today });
    expect(p.stop).toBe(true);
    expect(p.lead).toEqual({ outreach_status: "stopped" });
  });
  it("reads the address out of a From line", () => {
    expect(emailFrom('"Jane Doe" <Jane.Doe@Acme.com>')).toBe("jane.doe@acme.com");
    expect(emailFrom("bob@mill.com")).toBe("bob@mill.com");
  });
  it("keeps only the new part of a reply", () => {
    expect(stripQuoted("Send me rates to GA.\n\nOn Tue, Oct 27, 2026 Micheal wrote:\n> Hi there")).toBe("Send me rates to GA.");
  });
  it("matches a bounce to the lead address it mentions", () => {
    expect(findBouncedEmail("Address not found: Shipping@Acme.com could not be delivered", ["shipping@acme.com", "x@y.com"])).toBe("shipping@acme.com");
  });
  it("searches a limited number of addresses per Gmail search", () => {
    const qs = replySearches(Array.from({ length: 31 }, (_, i) => `a${i}@x.com`), 100);
    expect(qs).toHaveLength(3);
    expect(qs[0]).toContain("after:100");
  });
  it("falls back to simple word checks without AI", () => {
    expect(fallbackCategory("Automatic reply: out of office", "")).toBe("auto_reply");
    expect(fallbackCategory("Re: capacity", "Please remove me from your list")).toBe("opt_out");
  });
});
