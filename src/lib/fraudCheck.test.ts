import { describe, expect, it } from "vitest";
import { contactRisk } from "./fraudCheck";

const f = { email: "dispatch@abctrucking.com", phone: "(336) 555-1212", cell_phone: null };

describe("contactRisk", () => {
  it("flags a domain one letter off as high risk", () => {
    expect(contactRisk({ email: "dispatch@abctruckin.com" }, f)[0].level).toBe("high");
  });
  it("flags same name on a different TLD", () => {
    expect(contactRisk({ email: "dispatch@abctrucking.net" }, f)[0].level).toBe("high");
  });
  it("passes an exact domain match", () => {
    expect(contactRisk({ email: "ops@abctrucking.com" }, f)[0].level).toBe("ok");
  });
  it("flags a phone that is not on FMCSA", () => {
    expect(contactRisk({ phone: "919-000-0000" }, f)[0].level).toBe("high");
    expect(contactRisk({ phone: "+1 336 555 1212" }, f)[0].level).toBe("ok");
  });
});
