import { describe, expect, it } from "vitest";
import { assessIp } from "./ipRisk";

describe("signing IP risk", () => {
  it("passes a US residential ISP", () => expect(assessIp("US", "Comcast Cable").risk).toBeNull());
  it("passes Canada", () => expect(assessIp("CA", "Rogers").risk).toBeNull());
  it("flags a foreign country", () => expect(assessIp("AM", "Ucom").risk).toContain("outside the US/Canada"));
  it("flags a US VPN/datacenter", () => expect(assessIp("US", "DigitalOcean, LLC").risk).toContain("VPN"));
  it("flags Tor", () => expect(assessIp("T1", null).risk).toContain("Tor"));
});
