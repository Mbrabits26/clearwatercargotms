import { describe, expect, it } from "vitest";
import { defaultLanding } from "./landing";

describe("defaultLanding", () => {
  it("admin lands on Home", () => expect(defaultLanding({ isAdmin: true, isAccountant: true })).toBe("/home"));
  it("accountant lands on Accounting", () => expect(defaultLanding({ isAdmin: false, isAccountant: true })).toBe("/quickbooks"));
  it("broker lands on Dispatch", () => expect(defaultLanding({ isAdmin: false, isAccountant: false })).toBe("/dispatch"));
});
