import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { documentPdf } from "../lib/documentPdf";

vi.mock("@/lib/podPdf", async () => {
  const actual = await vi.importActual<typeof import("../lib/podPdf")>("../lib/podPdf");
  return { ...actual, podImageBytes: async (file: File) => new Uint8Array(await file.arrayBuffer()) };
});
function file(bytes: Uint8Array, name: string, type: string) {
  const f = new File([new Uint8Array(bytes)], name, { type });
  f.arrayBuffer = async () => new Uint8Array(bytes).buffer;
  return f;
}
describe("staff document PDFs", () => {
  it("preserves an existing PDF without rewriting its signed bytes", async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const source = file(await pdf.save(), "signed.pdf", "application/pdf");
    expect(await documentPdf([source])).toBe(source);
  });
  it("makes a photo and all selected PDF pages one ordered document", async () => {
    const pdf = await PDFDocument.create(); pdf.addPage([200, 300]); pdf.addPage([400, 500]);
    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
    const result = await documentPdf([file(png, "BOL.png", "image/png"), file(await pdf.save(), "pages.pdf", "application/pdf")]);
    expect(result.name).toBe("BOL.pdf"); expect(result.type).toBe("application/pdf");
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error("bad result")); reader.readAsArrayBuffer(result);
    });
    const saved = await PDFDocument.load(bytes);
    expect(saved.getPages().map(p => p.getWidth())).toEqual([612, 200, 400]);
    expect(saved.getTitle()).toBe("BOL");
  });
  it("refuses an unreadable page rather than silently dropping it", async () => {
    await expect(documentPdf([file(new Uint8Array([1,2]), "broken.png", "image/png")])).rejects.toThrow("broken.png");
  });
});