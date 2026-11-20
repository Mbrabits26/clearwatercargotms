import { expect, it } from "vitest";
import { googleVoiceUrl, trackingCopyText } from "../lib/trackingCopy";
it("addresses the existing Google Voice thread using the normalized driver number", () => {
  expect(googleVoiceUrl("(336) 555-0100")).toBe("https://voice.google.com/u/0/messages?itemId=t.%2B13365550100");
  expect(googleVoiceUrl("+1 336 555 0100")).toBe("https://voice.google.com/u/0/messages?itemId=t.%2B13365550100");
  expect(googleVoiceUrl("555-0100")).toBeNull();
});
it("includes the driver's phone alongside copied tracking text when requested", () => {
  expect(trackingCopyText("Tracking link", "336-555-0100", true)).toBe("To: 336-555-0100\n\nTracking link");
});
it("keeps Google Voice's message body free of the recipient header", () => {
  expect(trackingCopyText("Tracking link", "336-555-0100", false)).toBe("Tracking link");
});