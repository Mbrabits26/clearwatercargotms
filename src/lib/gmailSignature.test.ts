import { describe, expect, it } from "vitest";
import { signatureHtmlToText } from "./gmailSignature.server";

describe("signatureHtmlToText", () => {
  it("turns a typical Gmail HTML signature into plain text lines", () => {
    const html = `<div dir="ltr">Michael Brabits<br><b>Clearwater Cargo, LLC</b><br>Staley, NC<br><a href="tel:3365551234">336-555-1234</a><br>micheal@clearwatercargo.com</div>`;
    expect(signatureHtmlToText(html)).toBe(
      "Michael Brabits\nClearwater Cargo, LLC\nStaley, NC\n336-555-1234\nmicheal@clearwatercargo.com",
    );
  });

  it("decodes entities and collapses blank runs", () => {
    expect(signatureHtmlToText("<p>Tom &amp; Co&nbsp;LLC</p><p></p><p>MC 123</p>")).toBe("Tom & Co LLC\n\nMC 123");
  });

  it("returns empty string for empty/html-only input", () => {
    expect(signatureHtmlToText("")).toBe("");
    expect(signatureHtmlToText("<div><br></div>")).toBe("");
  });
});
