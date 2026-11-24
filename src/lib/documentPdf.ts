import { buildPodPdf, podImageBytes } from "@/lib/podPdf";

export const isDocumentImage = (file: File) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif|bmp)$/i.test(file.name);
export const isDocumentPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** Existing PDFs stay byte-for-byte intact; reviewed photos become one PDF in selection order. */
export async function documentPdf(files: File[]): Promise<File> {
  const first = files[0];
  if (!first) throw new Error("Choose a document first.");
  if (files.length === 1 && isDocumentPdf(first)) return first;
  if (files.every(f => isDocumentImage(f) || isDocumentPdf(f))) {
    const pages = await Promise.all(files.map(async f => ({ name: f.name, bytes: await podImageBytes(f) })));
    const bytes = await buildPodPdf(pages);
    // This is a generic document, not a declaration that it is a signed POD.
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes);
    pdf.setTitle(first.name.replace(/\.[^.]+$/, ""));
    return new File([new Uint8Array(await pdf.save())], first.name.replace(/\.[^.]+$/, "") + ".pdf", { type: "application/pdf" });
  }
  if (files.length !== 1) throw new Error("Combine photos and PDFs only; upload other documents separately.");
  let text: string;
  if (/\.(xlsx|xls|csv)$/i.test(first.name)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await first.arrayBuffer(), { type: "array" });
    text = wb.SheetNames.map(name => {
      const sheet = wb.Sheets[name];
      return `Sheet: ${name}\n${sheet ? XLSX.utils.sheet_to_csv(sheet) : ""}`;
    }).join("\n\n");
  } else if (/\.(txt|eml)$/i.test(first.name)) {
    text = await first.text();
  } else return first;
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape" });
  pdf.setFont("courier"); pdf.setFontSize(9);
  let y = 15;
  for (const line of text.split(/\r?\n/)) {
    const wrapped = pdf.splitTextToSize(line || " ", 267) as string[];
    for (const part of wrapped) {
      if (y > 195) { pdf.addPage(); y = 15; }
      pdf.text(part, 15, y); y += 4;
    }
  }
  return new File([pdf.output("blob")], first.name.replace(/\.[^.]+$/, "") + ".pdf", { type: "application/pdf" });
}