import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectQuad, enhance, outputSize, warp, type Quad, type ScanMode } from "@/lib/docScanner";

const MAX = 2000;

async function loadCanvas(file: File, turns: number) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const s = Math.min(1, MAX / Math.max(image.naturalWidth, image.naturalHeight));
    const w = Math.round(image.naturalWidth * s), h = Math.round(image.naturalHeight * s);
    const c = document.createElement("canvas");
    const side = turns % 2 === 1;
    c.width = side ? h : w; c.height = side ? w : h;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width / 2, c.height / 2); ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

function autoQuad(c: HTMLCanvasElement): Quad {
  const s = Math.min(1, 320 / Math.max(c.width, c.height));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(c.width * s)); small.height = Math.max(1, Math.round(c.height * s));
  const ctx = small.getContext("2d")!; ctx.drawImage(c, 0, 0, small.width, small.height);
  const q = detectQuad(ctx.getImageData(0, 0, small.width, small.height));
  return q.map(p => ({ x: p.x / s, y: p.y / s })) as Quad;
}

/** Driver reviews the auto-cropped page: drag corners, rotate, pick look, then keep. */
export function ScanReview({ file, onDone }: { file: File; onDone: (result: File | null) => void }) {
  const [turns, setTurns] = useState(0);
  const [canvas, setCanvas] = useState<HTMLCanvasElement>();
  const [quad, setQuad] = useState<Quad>();
  const [mode, setMode] = useState<ScanMode>("enhanced");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    loadCanvas(file, turns).then(c => { if (live) { setCanvas(c); setQuad(autoQuad(c)); } }).catch(() => onDone(file));
    return () => { live = false; };
  }, [file, turns]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (e: React.PointerEvent) => {
    if (drag.current === null || !canvas || !quad || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = Math.min(canvas.width, Math.max(0, ((e.clientX - r.left) / r.width) * canvas.width));
    const y = Math.min(canvas.height, Math.max(0, ((e.clientY - r.top) / r.height) * canvas.height));
    const next = [...quad] as Quad; next[drag.current] = { x, y }; setQuad(next);
  };

  const keep = async () => {
    if (!canvas || !quad) return;
    setBusy(true);
    try {
      let out = canvas;
      if (mode !== "original") {
        const src = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
        const size = outputSize(quad, MAX);
        out = document.createElement("canvas"); out.width = size.width; out.height = size.height;
        const ctx = out.getContext("2d")!;
        const dst = ctx.createImageData(size.width, size.height);
        warp(src, quad, dst);
        if (mode === "enhanced") enhance(dst);
        ctx.putImageData(dst, 0, 0);
      }
      const blob = await new Promise<Blob>((ok, no) => out.toBlob(b => b ? ok(b) : no(new Error("scan failed")), "image/jpeg", 0.85));
      onDone(new File([blob], file.name.replace(/\.[^.]+$/, "") + "-scan.jpg", { type: "image/jpeg" }));
    } catch { onDone(file); } finally { setBusy(false); }
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 p-3" role="dialog" aria-label="Review scanned POD page">
      <div className="mb-2 text-center text-sm font-semibold">Check the page — drag the dots to the paper's corners</div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {canvas && quad ? (
          <div ref={box} className="relative max-h-full touch-none select-none" style={{ aspectRatio: `${canvas.width}/${canvas.height}`, height: "100%", maxWidth: "100%" }}
            onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
            <img src={canvas.toDataURL("image/jpeg", 0.7)} alt="POD photo" className="h-full w-full object-contain" draggable={false} />
            {mode !== "original" && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${canvas.width} ${canvas.height}`} preserveAspectRatio="none">
              <polygon points={quad.map(p => `${p.x},${p.y}`).join(" ")} className="fill-primary/20 stroke-primary" strokeWidth={canvas.width / 200} />
            </svg>}
            {mode !== "original" && quad.map((p, i) => (
              <button key={i} type="button" aria-label={`Corner ${i + 1}`} className="absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-primary bg-background/70"
                style={{ left: pct(p.x, canvas.width), top: pct(p.y, canvas.height) }}
                onPointerDown={e => { drag.current = i; (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); }} />
            ))}
          </div>
        ) : <p className="text-muted-foreground">Scanning…</p>}
      </div>
      <div className="mt-3 space-y-2">
        <div className="grid grid-cols-4 gap-2">
          {([["enhanced", "Scan B&W"], ["color", "Scan color"], ["original", "Original"]] as const).map(([m, label]) => (
            <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>{label}</Button>
          ))}
          <Button size="sm" variant="outline" aria-label="Rotate" onClick={() => setTurns(t => (t + 1) % 4)}><RotateCw className="h-4 w-4" /></Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onDone(null)}>Retake / skip</Button>
          <Button disabled={busy || !canvas} onClick={keep}>{busy ? "Saving…" : "Looks good — keep page"}</Button>
        </div>
      </div>
    </div>
  );
}
