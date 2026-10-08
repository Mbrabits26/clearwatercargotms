import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A document stored in a private bucket, or a generated in-memory file. */
export type DocItem = { name: string; bucket?: "carrier-docs" | "load-docs"; path?: string; blob?: Blob };

const ext = (n: string) => n.toLowerCase().split(".").pop() ?? "";
const kindOf = (d: DocItem): "pdf" | "image" | "other" => {
  const t = d.blob?.type ?? "";
  const e = ext(d.path || d.name);
  if (t === "application/pdf" || e === "pdf") return "pdf";
  if (t.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(e)) return "image";
  return "other";
};

/** Resolves a temporary URL for a document (signed URL for storage, object URL for generated files). */
function useDocUrl(d: DocItem | null, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null); setErr(null);
    if (!d || !enabled) return;
    if (d.blob) {
      const u = URL.createObjectURL(d.blob);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    if (!d.bucket || !d.path) return;
    let live = true;
    supabase.storage.from(d.bucket).createSignedUrl(d.path, 600).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(error.message); else setUrl(data.signedUrl);
    });
    return () => { live = false; };
  }, [d?.bucket, d?.path, d?.blob, enabled]);
  return { url, err };
}

function Frame({ d, url, small }: { d: DocItem; url: string; small?: boolean }) {
  const k = kindOf(d);
  if (k === "image") return <img src={url} alt={d.name} className={cn("mx-auto object-contain", small ? "max-h-56" : "max-h-[75vh]")} />;
  if (k === "pdf") return <iframe title={d.name} src={`${url}#toolbar=1&view=FitH`} className={cn("w-full rounded bg-white", small ? "h-56" : "h-[75vh]")} />;
  return <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground"><FileText className="h-10 w-10" />No preview for this file type — use Download.</div>;
}

async function download(d: DocItem, url: string) {
  const blob = d.blob ?? (await (await fetch(url)).blob());
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = d.name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

export function DocViewer({ items, index, onClose }: { items: DocItem[]; index: number | null; onClose: () => void }) {
  const [i, setI] = useState(index ?? 0);
  useEffect(() => { if (index != null) setI(index); }, [index]);
  const d = index == null ? null : items[i] ?? null;
  const { url, err } = useDocUrl(d);
  return (
    <Dialog open={index != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle className="truncate pr-8 text-base">{d?.name}</DialogTitle></DialogHeader>
        <div className="min-h-40">
          {err ? <p className="text-sm text-destructive">{err}</p> : d && url ? <Frame d={d} url={url} /> : <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {items.length > 1 && (<>
              <Button size="sm" variant="outline" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-xs text-muted-foreground">{i + 1} of {items.length}</span>
              <Button size="sm" variant="outline" disabled={i >= items.length - 1} onClick={() => setI(i + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </>)}
          </div>
          <div className="flex gap-2">
            {url && <Button size="sm" variant="outline" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Open in new tab</a></Button>}
            {d && url && <Button size="sm" onClick={() => download(d, url)}><Download className="mr-1 h-4 w-4" />Download</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HoverPreview({ d }: { d: DocItem }) {
  const { url } = useDocUrl(d);
  return <div className="w-72">{url ? <Frame d={d} url={url} small /> : <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" />}<p className="mt-1 truncate text-xs text-muted-foreground">{d.name} · click to open</p></div>;
}

/** Clickable document name: hover shows a small preview (desktop), click opens the full viewer. */
export function DocLink({ items, index = 0, children, className }: { items: DocItem[]; index?: number; children?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const d = items[index]!;
  return (
    <>
      <HoverCard openDelay={350} onOpenChange={setHover}>
        <HoverCardTrigger asChild>
          <button type="button" className={cn("text-left underline decoration-dotted underline-offset-2 hover:text-gold", className)} onClick={() => setOpen(index)}>
            {children ?? d.name}
          </button>
        </HoverCardTrigger>
        <HoverCardContent className="hidden w-auto p-2 md:block" side="top">{hover && <HoverPreview d={d} />}</HoverCardContent>
      </HoverCard>
      <DocViewer items={items} index={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** Open a generated PDF (jsPDF) in the viewer instead of downloading it. */
export function useBlobViewer() {
  const [item, setItem] = useState<DocItem | null>(null);
  const viewer = <DocViewer items={item ? [item] : []} index={item ? 0 : null} onClose={() => setItem(null)} />;
  return { show: (blob: Blob, name: string) => setItem({ blob, name }), viewer };
}
