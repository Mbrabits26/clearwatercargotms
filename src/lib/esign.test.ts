import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { addSignatureCertificate, sha256Hex, stableJson } from "./esign";

describe("e-signature fingerprints", () => {
  it("uses standard SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("gives the same terms fingerprint regardless of field order", async () => {
    const a = await sha256Hex(stableJson({ rc: "CW-1", total: 1800, lines: [{ label: "Linehaul", amount: 1800 }] }));
    const b = await sha256Hex(stableJson({ lines: [{ amount: 1800, label: "Linehaul" }], total: 1800, rc: "CW-1" }));
    expect(a).toBe(b);
  });

  it("changes the terms fingerprint when the rate changes", async () => {
    const a = await sha256Hex(stableJson({ rc: "CW-1", total: 1800 }));
    const b = await sha256Hex(stableJson({ rc: "CW-1", total: 1801 }));
    expect(a).not.toBe(b);
  });

  it("adds a certificate page to the signed PDF", () => {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    addSignatureCertificate(doc, {
      document: "Rate Confirmation RC #CW-1", reference: "RC-CW-1-ABCD", parties: "Clearwater Cargo LLC and Test Carrier",
      signer: "Jane Doe", signedAt: "2026-10-30T23:00:00.000Z", ip: "203.0.113.5", device: "Mozilla/5.0",
      consent: "I agree.", termsSha256: "a".repeat(64),
    });
    expect(doc.getNumberOfPages()).toBe(2);
  });
});
