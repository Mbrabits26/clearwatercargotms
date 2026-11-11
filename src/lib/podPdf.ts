import { PDFDocument } from "pdf-lib";

/** All selected pages become one document; never silently omit an unreadable page. */
export async function buildPodPdf(files: { name: string; bytes: Uint8Array }[]) {
  if (!files.length) throw new Error("Add at least one POD photo.");
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const bytes = file.bytes;
    try {
      if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
        const source = await PDFDocument.load(bytes);
        if (!source.getPageCount()) throw new Error("Empty PDF");
        const pages = await pdf.copyPages(source, source.getPageIndices());
        pages.forEach(page => pdf.addPage(page));
      } else {
        const image = bytes[0] === 0x89 && bytes[1] === 0x50
          ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const width = image.width > image.height ? 792 : 612;
        const height = image.width > image.height ? 612 : 792;
        const page = pdf.addPage([width, height]);
        const scale = Math.min((width - 32) / image.width, (height - 32) / image.height);
        const w = image.width * scale, h = image.height * scale;
        page.drawImage(image, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h });
      }
    } catch {
      throw new Error(`Could not read ${file.name}. Please replace that photo or PDF and try again.`);
    }
  }
  pdf.setTitle("Signed proof of delivery");
  return pdf.save();
}

/** Decode phone photos in the browser so rotation is respected and other image formats can be converted. */
export async function podImageBytes(file: File): Promise<Uint8Array> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return new Uint8Array(await file.arrayBuffer());
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo conversion unavailable");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("Photo conversion failed")), "image/jpeg", 0.92));
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    throw new Error(`Could not read ${file.name}. Please choose a JPEG, PNG or PDF.`);
  } finally { URL.revokeObjectURL(url); }
}