import { Button } from "@/components/ui/button";

/** Load document types a person must pick before an upload finishes. The value becomes the stored file-name prefix. */
export const LOAD_DOC_TYPES = [
  { value: "pod", label: "Signed POD" },
  { value: "bol", label: "BOL" },
  { value: "ratecon", label: "Rate con" },
  { value: "lumper", label: "Lumper receipt" },
  { value: "scale", label: "Scale ticket" },
  { value: "other", label: "Other" },
] as const;
export type LoadDocType = (typeof LOAD_DOC_TYPES)[number]["value"];

export const loadDocPath = (loadId: string, type: LoadDocType, file: File) =>
  `${loadId}/${type}-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;

/** Shown after a file is picked or dropped: one tap on a type uploads it; Cancel drops it. */
export function DocTypePicker({ file, busy, onPick, onCancel }: { file: File | null; busy?: boolean; onPick: (t: LoadDocType) => void; onCancel: () => void }) {
  if (!file) return null;
  return (
    <div className="space-y-2 rounded-md border border-gold/50 bg-gold/10 p-2">
      <div className="text-xs"><b>What is this document?</b> <span className="text-muted-foreground">{file.name}</span></div>
      <div className="flex flex-wrap gap-1.5">
        {LOAD_DOC_TYPES.map((t) => (
          <Button key={t.value} size="sm" variant="secondary" disabled={busy} onClick={() => onPick(t.value)}>{t.label}</Button>
        ))}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
