import { describe, expect, it } from "vitest";
import { rateconPhone, rateconText } from "../lib/rateconDelivery";

describe("rate confirmation phone delivery", () => {
  it("normalizes a US phone number for Google Voice and SMS", () => {
    expect(rateconPhone("(336) 555-0100")).toBe("+13365550100");
    expect(rateconPhone("1-336-555-0100")).toBe("+13365550100");
  });
  it("rejects incomplete phone numbers", () => {
    expect(rateconPhone("555-0100")).toBeNull();
    expect(rateconPhone("")).toBeNull();
  });
  it("preserves explicitly entered international numbers", () => {
    expect(rateconPhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("includes the load and signing link in the text", () => {
    const text = rateconText("CW-10544", "Staley, NC → Richmond, VA", "https://tms.clearwatercargo.com/sign/test-token");
    expect(text).toContain("CW-10544");
    expect(text).toContain("https://tms.clearwatercargo.com/sign/test-token");
  });
});