import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), upload: vi.fn(), upsert: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  storage: { from: () => ({ list: mocks.list, upload: mocks.upload }) },
  from: () => ({ upsert: mocks.upsert }),
} }));
import { attachLoadSource } from "../lib/loadSourceDocument";
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ data: [], error: null }); mocks.upload.mockResolvedValue({ error: null }); mocks.upsert.mockResolvedValue({ error: null }); });
describe("load creation source attachment", () => {
  it("attaches the source PDF to every created load and copy", async () => {
    const f = new File(["pdf"], "tender.pdf", { type: "application/pdf" });
    await attachLoadSource(["load-a", "load-b"], f, "attempt", [f]);
    expect(mocks.upload.mock.calls.map(c => c[0])).toEqual(["load-a/other-source-attempt-0-tender.pdf", "load-b/other-source-attempt-0-tender.pdf"]);
  });
  it("retries an existing attachment without uploading another copy", async () => {
    mocks.list.mockResolvedValue({ data: [{ name: "other-source-attempt-0-tender.pdf" }], error: null });
    await attachLoadSource(["load-a"], new File(["pdf"], "tender.pdf"), "attempt", []);
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
  it("retains the original spreadsheet alongside its PDF", async () => {
    await attachLoadSource(["load-a"], new File(["pdf"], "tender.pdf"), "attempt", [new File(["sheet"], "tender.xlsx")]);
    expect(mocks.upload.mock.calls.map(c => c[0])).toEqual(["load-a/other-source-attempt-0-tender.pdf", "load-a/other-source-attempt-1-tender.xlsx"]);
  });
  it("reports an upload failure instead of claiming the file was saved", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "Upload failed" } });
    await expect(attachLoadSource(["load-a"], new File(["pdf"], "tender.pdf"), "attempt", [])).rejects.toThrow("Upload failed");
  });
});