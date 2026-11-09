import { expect, it } from "vitest";
import { trackingCopyText } from "../lib/trackingCopy";
it("includes the driver's phone alongside copied tracking text when requested", () => {
  expect(trackingCopyText("Tracking link", "336-555-0100", true)).toBe("To: 336-555-0100\n\nTracking link");
});
it("keeps Google Voice's message body free of the recipient header", () => {
  expect(trackingCopyText("Tracking link", "336-555-0100", false)).toBe("Tracking link");
});