import { PDFDocument } from "pdf-lib";
import { isPodDoc } from "./qbAttachments";

/** What a stored load document is, for building a customer invoice packet. */
export type PacketDocKind = "pod" | "bol" | "ratecon" | "invoice" | "carrier_invoice" | "other";

export function packetDocKind(fileName: string, displayName?: string | null): PacketDocKind {
  const base = fileName.split("/").pop() ?? "";
  if (/^carrier_invoice-/i.test(base)) return "carrier_invoice";
  if (/^invoice-/i.test(base)) return "invoice";
  if (/^ratecon-/i.test(base)) return "ratecon";
  if (isPodDoc(fileName, displayName)) return "pod";
  const names = [base, displayName ?? ""];
  if (names.some((n) => /(^|[^a-z])bols?(?![a-z])|bill[\s_-]*of[\s_-]*lading/i.test(n))) return "bol";
  if (names.some((n) => /rate[\s_-]*con/i.test(n))) return "ratecon";
  return "other";
}

export const PACKET_KIND_LABEL: Record<PacketDocKind, string> = {
  pod: "POD", bol: "BOL", ratecon: "Carrier rate con", invoice: "Invoice", carrier_invoice: "Carrier invoice", other: "Other file",
};

/** Ticked by default: proof of delivery and BOL. Carrier rate cons/invoices show carrier pay, so never by default. */
export const packetDefault = (k: PacketDocKind) => k === "pod" || k === "bol";
/** Never offered in a customer packet — they reveal what we pay the carrier. */
export const packetHidden = (k: PacketDocKind) => k === "carrier_invoice" || k === "invoice";

const ORDER: PacketDocKind[] = ["pod", "bol", "other", "ratecon"];
export const packetSort = <T extends { kind: PacketDocKind }>(docs: T[]) => [...docs].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

type FileKind = "pdf" | "jpg" | "png" | null;
export function sniff(bytes: Uint8Array): FileKind {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

const LETTER: [number, number] = [612, 792];

/**
 * One PDF: the invoice first, then each picked document. PDFs are copied page by page; JPG/PNG
 * photos are placed on a letter page. Files that can't be read (other types, locked PDFs) are skipped.
 */
export async function mergePacket(invoice: Uint8Array | ArrayBuffer, files: { name: string; bytes: Uint8Array | ArrayBuffer }[]) {
  const out = await PDFDocument.create();
  const skipped: string[] = [];
  const addPdf = async (bytes: Uint8Array | ArrayBuffer) => {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  };
  await addPdf(invoice);
  for (const f of files) {
    const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
    const kind = sniff(bytes);
    try {
      if (kind === "pdf") await addPdf(bytes);
      else if (kind === "jpg" || kind === "png") {
        const img = kind === "jpg" ? await out.embedJpg(bytes) : await out.embedPng(bytes);
        const page = out.addPage(LETTER);
        const m = 24;
        const s = Math.min((LETTER[0] - 2 * m) / img.width, (LETTER[1] - 2 * m) / img.height, 1);
        const w = img.width * s, h = img.height * s;
        page.drawImage(img, { x: (LETTER[0] - w) / 2, y: (LETTER[1] - h) / 2, width: w, height: h });
      } else skipped.push(f.name);
    } catch { skipped.push(f.name); }
  }
  out.setTitle("Invoice packet");
  out.setProducer("Clearwater Cargo TMS");
  return { bytes: await out.save(), pages: out.getPageCount(), skipped };
}
