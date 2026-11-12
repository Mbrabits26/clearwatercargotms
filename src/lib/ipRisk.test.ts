import { describe, expect, it } from "vitest";
import { assessIp } from "./ipRisk";

describe("signing IP risk", () => {
  it("passes a US residential ISP", () => expect(assessIp("US", "Comcast Cable").risk).toBeNull());
  it("flags Canada as outside the US", () => expect(assessIp("CA", "Rogers").risk).not.toBeNull());
  it("flags a foreign country", () => expect(assessIp("AM", "Ucom").risk).not.toBeNull());
  it("does not invent a foreign location when country is unknown", () => expect(assessIp("XX", null).risk).toBeNull());
  it("flags a US VPN/datacenter", () => expect(assessIp("US", "DigitalOcean, LLC").risk).toContain("VPN"));
  it("flags Tor", () => expect(assessIp("T1", null).risk).toContain("Tor"));
});
