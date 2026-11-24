import { useState } from "react";
import { toast } from "sonner";
import { ScanReview } from "@/components/ScanReview";
import { documentPdf, isDocumentImage } from "@/lib/documentPdf";

/** Reuse the driver's crop/rotate/original review for staff documents, without losing selected pages. */
export function useDocumentScan(onReady: (file: File, originals: File[]) => void | Promise<void>) {
  const [queue, setQueue] = useState<File[]>([]);
  const [originals, setOriginals] = useState<File[]>([]);
  const [pages, setPages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const finish = async (all: File[], sources: File[]) => {
    setBusy(true);
    try { await onReady(await documentPdf(all), sources); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't prepare the document."); }
    finally { setBusy(false); }
  };
  const advance = (remaining: File[], done: File[], sources: File[]) => {
    const next = remaining[0];
    if (!next) { setQueue([]); void finish(done, sources); return; }
    if (isDocumentImage(next)) { setQueue(remaining); setPages(done); return; }
    advance(remaining.slice(1), [...done, next], sources);
  };
  const choose = (files: File[]) => {
    if (!files.length || busy || queue.length) return;
    if (files.some(f => f.size > 10 * 1024 * 1024)) { toast.error("Each file must be 10 MB or smaller."); return; }
    setOriginals(files);
    advance(files, [], files);
  };
  const current = queue[0];
  const review = current ? <ScanReview label="document" key={current.name + current.lastModified + queue.length} file={current} onDone={result => {
    if (!result) { setQueue([]); setPages([]); return; }
    advance(queue.slice(1), [...pages, result], originals);
  }} /> : null;
  return { choose, review, busy: busy || !!current };
}