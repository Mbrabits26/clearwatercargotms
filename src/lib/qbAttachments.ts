/** Load documents picked to ride along with a QuickBooks invoice or bill. */
export type QbAttachment = { path: string; name: string };

export function parseAttachments(v: unknown): QbAttachment[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((a) => (a && typeof a === "object" && typeof (a as QbAttachment).path === "string" ? [{ path: (a as QbAttachment).path, name: String((a as QbAttachment).name || (a as QbAttachment).path.split("/").pop()) }] : []));
}

const sentPaths = (sent: unknown) => new Set(Array.isArray(sent) ? sent.map((s) => (typeof s === "string" ? s : String((s as QbAttachment)?.path ?? ""))) : []);

/** Picked files not yet uploaded to QuickBooks — a file is never uploaded twice. */
export function pendingAttachments(attachments: unknown, sent: unknown): QbAttachment[] {
  const done = sentPaths(sent);
  const seen = new Set<string>();
  return parseAttachments(attachments).filter((a) => !done.has(a.path) && !seen.has(a.path) && seen.add(a.path));
}

export const isSent = (path: string, sent: unknown) => sentPaths(sent).has(path);

/**
 * Is this load document a POD? Driver uploads are stored as "pod-…"; staff uploads and
 * renamed files count when the file or display name has "POD" as its own word (POD, POD123,
 * signed_pod.pdf) or says "proof of delivery". "ipod"/"podium" don't count.
 */
export function isPodDoc(fileName: string, displayName?: string | null): boolean {
  return [fileName.split("/").pop() ?? "", displayName ?? ""].some((n) =>
    /(^|[^a-z])pods?(?![a-z])/i.test(n) || /proof[\s_-]*of[\s_-]*delivery/i.test(n));
}

/**
 * Adds POD files to an invoice's attachment list. Skips files QuickBooks wouldn't accept and
 * any path already picked or sent on this invoice (`taken`), so nothing goes twice.
 */
export function withPods(attachments: unknown, pods: QbAttachment[], taken: Set<string>): { list: QbAttachment[]; added: number } {
  const list = parseAttachments(attachments);
  const have = new Set([...taken, ...list.map((a) => a.path)]);
  let added = 0;
  for (const p of pods) {
    if (have.has(p.path) || (!qbContentType(p.name) && !qbContentType(p.path))) continue;
    have.add(p.path); list.push(p); added++;
  }
  return { list, added };
}

/** File types QuickBooks Online accepts as attachments. */
const TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", png: "image/png", gif: "image/gif",
  tif: "image/tiff", tiff: "image/tiff", txt: "text/plain", csv: "text/csv", rtf: "application/rtf", xml: "text/xml",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
};
export const qbContentType = (name: string): string | null => TYPES[(name.split(".").pop() ?? "").toLowerCase()] ?? null;

/** Multipart body for the QuickBooks /upload endpoint (metadata JSON part + file part). */
export function qbUploadBody(boundary: string, meta: unknown, bytes: Uint8Array, fileName: string, contentType: string) {
  const safe = fileName.replace(/["\r\n]/g, "_");
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file_metadata_01"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file_content_01"; filename="${safe}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const out = new Uint8Array(head.length + bytes.length + tail.length);
  out.set(head, 0); out.set(bytes, head.length); out.set(tail, head.length + bytes.length);
  return out;
}
