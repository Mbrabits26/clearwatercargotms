import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

/** Load document types a person must pick before an upload finishes. The value becomes the stored file-name prefix. */
export const LOAD_DOC_TYPES = [
  { value: "pod", label: "Signed POD" },
  { value: "bol", label: "BOL" },
  { value: "ratecon", label: "Rate con" },
  { value: "lumper", label: "Lumper receipt" },
  { value: "scale", label: "Scale ticket" },
  { value: "carrier_invoice", label: "Carrier invoice" },
  { value: "factoring_invoice", label: "Factoring company invoice" },
  { value: "other", label: "Custom document" },
] as const;
export type LoadDocType = (typeof LOAD_DOC_TYPES)[number]["value"];

export const loadDocPath = (loadId: string, type: LoadDocType, file: File) =>
  `${loadId}/${type}-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;

const typePrefix = new RegExp(`^(${LOAD_DOC_TYPES.map((t) => t.label).join("|")})\\s+[–-]\\s+`, "i");
/** Re-label an already-stored file: its display name becomes "<Type> – <name>" (any earlier type prefix is replaced). */
export const retypedName = (type: LoadDocType, name: string, custom?: string) =>
  `${type === "other" && custom?.trim() ? custom.trim() : LOAD_DOC_TYPES.find((t) => t.value === type)?.label ?? "Document"} – ${name.replace(typePrefix, "")}`;
/** The type a person picked for a stored file, read back from its display name. */
export const typeFromName = (name: string): LoadDocType | null => {
  const m = name.match(typePrefix);
  return m ? LOAD_DOC_TYPES.find((t) => t.label.toLowerCase() === m[1]?.toLowerCase())?.value ?? null : null;
};

/** Shown after a file is picked or dropped: one tap on a type uploads it; Cancel drops it. */
export function DocTypePicker({ file, busy, onPick, onCancel, invoices = true }: { file: File | null; busy?: boolean; onPick: (t: LoadDocType, custom?: string) => void; onCancel: () => void; invoices?: boolean }) {
  const [custom, setCustom] = useState("");
  if (!file) return null;
  return (
    <div className="space-y-2 rounded-md border border-gold/50 bg-gold/10 p-2">
      <div className="text-xs"><b>What is this document?</b> <span className="text-muted-foreground">{file.name}</span></div>
      <div className="flex flex-wrap gap-1.5">
        {LOAD_DOC_TYPES.filter((t) => t.value !== "other" && (invoices || !t.value.endsWith("invoice"))).map((t) => (
          <Button key={t.value} size="sm" variant="secondary" disabled={busy} onClick={() => onPick(t.value)}>{t.label}</Button>
        ))}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
      <div className="flex gap-2">
        <Input aria-label="Custom document description" maxLength={100} placeholder="Type document description" value={custom} onChange={(e) => setCustom(e.target.value)} disabled={busy} />
        <Button size="sm" disabled={busy || !custom.trim()} onClick={() => onPick("other", custom.trim())}>Save document</Button>
      </div>
    </div>
  );
}
