import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildPodPdf } from "../lib/podPdf";

const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
describe("POD photos become one PDF", () => {
  it("converts a single PNG into a one-page PDF", async () => {
    const bytes = await buildPodPdf([{ name: "pod.png", bytes: png }]);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("combines multiple photos and every existing PDF page in selection order", async () => {
    const existing = await PDFDocument.create();
    existing.addPage([200, 300]); existing.addPage([400, 500]);
    const bytes = await buildPodPdf([{ name: "front.png", bytes: png }, { name: "pages.pdf", bytes: await existing.save() }, { name: "back.png", bytes: png }]);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.getPages().map(page => page.getWidth())).toEqual([612, 200, 400, 612]);
  });
  it("converts a JPEG photo into a PDF", async () => {
    const jpeg = new Uint8Array(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==", "base64"));
    expect((await PDFDocument.load(await buildPodPdf([{ name: "pod.jpeg", bytes: jpeg }]))).getPageCount()).toBe(1);
  });
  it("rejects unreadable pages instead of uploading an incomplete POD", async () => {
    await expect(buildPodPdf([{ name: "front.png", bytes: png }, { name: "bad.jpg", bytes: new Uint8Array([1,2,3]) }])).rejects.toThrow("bad.jpg");
  });
});