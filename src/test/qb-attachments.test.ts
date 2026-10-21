import { describe, expect, it } from "vitest";
import { pendingAttachments, qbContentType, qbUploadBody } from "@/lib/qbAttachments";

describe("QuickBooks invoice attachments", () => {
  it("only uploads files not already sent to QuickBooks", () => {
    const picked = [{ path: "L1/pod.pdf", name: "pod.pdf" }, { path: "L1/bol.pdf", name: "bol.pdf" }, { path: "L1/bol.pdf", name: "bol.pdf" }];
    expect(pendingAttachments(picked, ["L1/pod.pdf"]).map((a) => a.path)).toEqual(["L1/bol.pdf"]);
  });

  it("rejects file types QuickBooks does not accept", () => {
    expect(qbContentType("POD.PDF")).toBe("application/pdf");
    expect(qbContentType("photo.heic")).toBeNull();
  });

  it("builds a two-part upload with metadata first", () => {
    const body = new TextDecoder().decode(qbUploadBody("B", { FileName: "a.pdf" }, new TextEncoder().encode("X"), "a.pdf", "application/pdf"));
    expect(body.indexOf('name="file_metadata_01"')).toBeLessThan(body.indexOf('name="file_content_01"'));
    expect(body.endsWith("--B--\r\n")).toBe(true);
  });
});
