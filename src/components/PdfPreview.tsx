import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Render PDF pixels rather than relying on a phone's embedded PDF plugin. */
export default function PdfPreview({ url, name, small }: { url: string; name: string; small?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { setPage(1); }, [url]);
  useEffect(() => {
    let live = true;
    let cleanup: (() => void) | undefined;
    setBusy(true); setError("");
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const { default: worker } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      if (!live) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      const task = pdfjs.getDocument({ url });
      cleanup = () => { void task.destroy(); };
      const doc = await task.promise;
      if (!live) return;
      setPages(doc.numPages);
      const sheet = await doc.getPage(Math.min(page, doc.numPages));
      const base = sheet.getViewport({ scale: 1 });
      const viewport = sheet.getViewport({ scale: (small ? 560 : 1500) / base.width });
      const target = canvas.current;
      if (!target || !live) return;
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      await sheet.render({ canvas: target, viewport }).promise;
      if (live) setBusy(false);
    })().catch(() => { if (live) { setError("Could not display this PDF. Please download it or open it in a new tab."); setBusy(false); } });
    return () => { live = false; cleanup?.(); };
  }, [url, page, small]);
  return <div>
    {busy && <Loader2 className="mx-auto my-4 h-5 w-5 animate-spin text-muted-foreground" />}
    {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
    <div className={small ? "max-h-56 overflow-auto" : "max-h-[70vh] overflow-auto"}>
      <canvas ref={canvas} aria-label={name} className={busy || error ? "hidden" : "mx-auto h-auto w-full"} />
    </div>
    {!small && pages > 1 && <div className="mt-2 flex items-center justify-center gap-3">
      <Button variant="outline" size="icon" aria-label="Previous PDF page" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft /></Button>
      <span className="text-sm">{page} / {pages}</span>
      <Button variant="outline" size="icon" aria-label="Next PDF page" disabled={busy || page >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight /></Button>
    </div>}
  </div>;
}