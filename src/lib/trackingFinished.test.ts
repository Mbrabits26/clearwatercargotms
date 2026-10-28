import { describe, expect, it } from "vitest";
import { trackingFinished } from "./tracking.functions";

describe("driver link ends after delivery + signed POD", () => {
  it("ends when delivered with POD", () => expect(trackingFinished({ status: "delivered", pod_received: true })).toBe(true));
  it("stays open when delivered without POD", () => expect(trackingFinished({ status: "delivered", pod_received: false })).toBe(false));
  it("stays open while rolling even with POD", () => expect(trackingFinished({ status: "rolling", pod_received: true })).toBe(false));
  it("ends when invoiced with POD", () => expect(trackingFinished({ status: "invoiced", pod_received: true })).toBe(true));
});
