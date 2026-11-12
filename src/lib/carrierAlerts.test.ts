import { describe, expect, it } from "vitest";
import { carrierAlertRecipients, carrierCheckWarning, isCarrierSafetyAlert } from "./carrierAlerts";

const base = { legal_name: "Carrier", mc: "123", dot: "456", score: 97, grade: "Low risk" as const, flags: [] };
describe("carrier safety alerts", () => {
  it("notifies the sender, load broker and every admin without duplicates", () => {
    expect(carrierAlertRecipients("sender", ["admin1", "sender", "admin2"], "broker")).toEqual(["sender", "broker", "admin1", "admin2"]);
  });
  it("alerts on a yellow flag even when the overall grade remains low risk", () => {
    expect(carrierCheckWarning({ ...base, flags: [{ level: "amber", text: "One truck" }] })?.level).toBe("yellow");
  });
  it("alerts on red flags", () => {
    expect(carrierCheckWarning({ ...base, flags: [{ level: "red", text: "Revoked" }] })?.level).toBe("red");
  });
  it("does not generate a warning for a green check", () => expect(carrierCheckWarning(base)).toBeNull());
  it("warns on a yellow overall grade with no flags", () => expect(carrierCheckWarning({ ...base, grade: "Review", score: 80 })?.level).toBe("yellow"));
  it("recognizes mandatory safety notices independently of chat/mention preferences", () => {
    expect(isCarrierSafetyAlert("carrier_check")).toBe(true);
    expect(isCarrierSafetyAlert("signing_risk")).toBe(true);
    expect(isCarrierSafetyAlert("chat")).toBe(false);
  });
});