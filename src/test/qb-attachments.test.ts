import { describe, expect, it } from "vitest";
import { isPodDoc, pendingAttachments, qbContentType, qbUploadBody, withPods } from "@/lib/qbAttachments";

describe("auto-attaching PODs to customer invoices", () => {
  it("recognizes driver PODs, named PODs and renamed PODs", () => {
    expect(isPodDoc("L1/pod-1700000000-scan.jpg")).toBe(true);
    expect(isPodDoc("L1/file-1700000000-Signed_POD_CW15418.pdf")).toBe(true);
    expect(isPodDoc("L1/file-1700000000-scan.pdf", "Proof of delivery CW-15418.pdf")).toBe(true);
  });

  it("does not treat BOLs, rate cons or words containing 'pod' as PODs", () => {
    expect(isPodDoc("L1/bol-CW15418.pdf")).toBe(false);
    expect(isPodDoc("L1/ratecon-CW15418-sent.pdf")).toBe(false);
    expect(isPodDoc("L1/file-1-ipod_photo.jpg")).toBe(false);
  });

  it("adds a POD once and never re-adds one already picked or sent", () => {
    const pod = { path: "L1/pod-1-a.pdf", name: "pod-1-a.pdf" };
    expect(withPods([], [pod], new Set()).added).toBe(1);
    expect(withPods([pod], [pod], new Set()).added).toBe(0);
    expect(withPods([], [pod], new Set(["L1/pod-1-a.pdf"])).added).toBe(0);
  });

  it("skips POD files QuickBooks won't accept", () => {
    expect(withPods([], [{ path: "L1/pod-1-a.heic", name: "pod-1-a.heic" }], new Set()).added).toBe(0);
  });
});

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
