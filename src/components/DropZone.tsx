import { useRef, useState, type ReactNode } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

/** Drag-and-drop file target that also opens the file picker on click or Enter. */
export function DropZone({ accept, onFile, disabled, label, sub, icon, compact }: {
  accept: string; onFile: (f: File) => void; disabled?: boolean; label: ReactNode; sub?: ReactNode; icon?: ReactNode; compact?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (files: FileList | null | undefined) => { const f = files?.[0]; if (f && !disabled) onFile(f); };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && ref.current?.click()}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !disabled) { e.preventDefault(); ref.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-colors",
        compact ? "gap-1 p-3" : "gap-2 p-6",
        over ? "border-gold bg-gold/10" : "border-border hover:border-gold/60 hover:bg-muted/40",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      {icon ?? <UploadCloud className={cn("text-gold", compact ? "h-5 w-5" : "h-8 w-8")} />}
      <div className="text-sm font-medium">{label}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
    </div>
  );
}
