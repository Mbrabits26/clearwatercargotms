import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { loadString, type Company, type Load } from "@/lib/tms";
import { cn } from "@/lib/utils";

function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  // Older browsers / non-secure contexts: fall back to a hidden textarea.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } finally { ta.remove(); }
  return Promise.resolve();
}

/** One click: copies a paste-ready summary of the load (no rates or pay). */
export function CopyLoadString({
  load, companies, className, withLabel = false,
}: {
  load: Load;
  companies: Company[];
  className?: string;
  withLabel?: boolean;
}) {
  const [done, setDone] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const name = (id: string | null) => companies.find((c) => c.id === id)?.name ?? null;
    const text = loadString(load, {
      customer: name(load.customer_id),
      shipper: companies.find((c) => c.id === load.shipper_id) ?? null,
      consignee: companies.find((c) => c.id === load.consignee_id) ?? null,
    });
    try {
      await writeClipboard(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
      toast.success(`${load.load_number} copied — paste into a text, email or post`);
    } catch {
      toast.error("Your browser blocked copying. Select the text and copy it manually.");
    }
  };
  return (
    <button
      type="button"
      title="Copy load details"
      aria-label={`Copy ${load.load_number} details`}
      onClick={copy}
      className={cn(
        "inline-flex items-center gap-1 rounded border border-transparent px-1.5 py-1 text-muted-foreground transition hover:border-gold/40 hover:text-gold",
        className,
      )}
    >
      {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {withLabel && <span className="text-xs">{done ? "Copied" : "Copy string"}</span>}
    </button>
  );
}
